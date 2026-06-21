import {
  useState, useEffect, useRef,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import { useTheme } from '@mui/material/styles';
import {
  IconButton, Table, TableBody, TableCell, TableHead, TableRow, Checkbox, Typography, Box,
} from '@mui/material';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import LocationSearchingIcon from '@mui/icons-material/LocationSearching';
import RouteIcon from '@mui/icons-material/Route';
import dayjs from 'dayjs';
import {
  formatAddress,
  formatDistance,
  formatSpeed,
  formatVolume,
  formatTime,
  formatNumericHours,
} from '../common/util/formatter';
import ReportFilter, { updateReportParams } from './components/ReportFilter';
import { useAttributePreference, usePreference } from '../common/util/preferences';
import { useTranslation } from '../common/components/LocalizationProvider';
import PageLayout from '../common/components/PageLayout';
import ReportsMenu from './components/ReportsMenu';
import { useCatch, useEffectAsync } from '../reactHelper';
import { devicesActions } from '../store';
import useReportStyles from './common/useReportStyles';
import MapView from '../map/core/MapView';
import MapMultiRoutePath from '../map/MapMultiRoutePath';
import AddressValue from '../common/components/AddressValue';
import TableShimmer from '../common/components/TableShimmer';
import MapCamera from '../map/MapCamera';
import MapGeofence from '../map/MapGeofence';
import scheduleReport from './common/scheduleReport';
import MapScale from '../map/MapScale';
import fetchOrThrow from '../common/util/fetchOrThrow';
import exportExcel from '../common/util/exportExcel';

const columnsArray = [
  ['startTime', 'reportStartTime'],
  ['startOdometer', 'reportStartOdometer'],
  ['startAddress', 'reportStartAddress'],
  ['endTime', 'reportEndTime'],
  ['endOdometer', 'reportEndOdometer'],
  ['endAddress', 'reportEndAddress'],
  ['distance', 'sharedDistance'],
  ['averageSpeed', 'reportAverageSpeed'],
  ['maxSpeed', 'reportMaximumSpeed'],
  ['duration', 'reportDuration'],
  ['spentFuel', 'reportSpentFuel'],
  ['driverName', 'sharedDriver'],
];
const columnsMap = new Map(columnsArray);

const TripReportPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const { classes } = useReportStyles();
  const t = useTranslation();
  const theme = useTheme();

  const devices = useSelector((state) => state.devices.items);
  const selectedDeviceIds = useSelector((state) => state.devices.selectedIds);
  const period = useSelector((state) => state.reports.period);
  const reportFrom = useSelector((state) => state.reports.from);
  const reportTo = useSelector((state) => state.reports.to);

  const distanceUnit = useAttributePreference('distanceUnit');
  const speedUnit = useAttributePreference('speedUnit');
  const volumeUnit = useAttributePreference('volumeUnit');
  const coordinateFormat = usePreference('coordinateFormat');

  // Fixed column set for the trip report. The Columns dropdown was removed
  // intentionally so users can't drift away from these four.
  const columns = ['startTime', 'endTime', 'distance', 'averageSpeed'];
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  // Multi-trip selection state: array of selected trip rows.
  const [selectedItems, setSelectedItems] = useState([]);
  // Map of routeKey -> array of route positions for every selected trip.
  const [routes, setRoutes] = useState({});
  // Tracks whether a search has completed at least once. Drives the empty-state
  // message: we only want to say "no trips between X and Y" after the user (or
  // the auto-show effect) has actually run a query — otherwise the message
  // would flash on first render before any search has happened.
  const [hasShown, setHasShown] = useState(false);
  // From/to of the most recent completed search, used to echo the date range
  // back to the user in the empty-state message.
  const [shownRange, setShownRange] = useState(null);
  const hasAutoSubmitted = useRef(false);
  const lastShowParams = useRef(null);
  // Monotonic id for route-fetch runs. If the selection changes (or onShow
  // fires more than once during load) while routes are still loading, only the
  // most recent run is allowed to write state; older runs bail out. Prevents a
  // stale, partial result from overwriting a complete one.
  const routeRequestId = useRef(0);


  // Device auto-select: when devices have loaded and there's no deviceId or
  // groupId in the URL yet, populate the selection with every device the user
  // has access to. Without this, clicking "Show" with an empty selection
  // returns no trips on most installations — Traccar's "all devices when none
  // selected" v6.12 release note refers to the dropdown placeholder, not to
  // server-side behavior.
  const hasAutoSelected = useRef(false);
  useEffect(() => {
    if (hasAutoSelected.current) return;
    if (!devices || Object.keys(devices).length === 0) return;
    const urlDeviceIds = searchParams.getAll('deviceId');
    const urlGroupIds = searchParams.getAll('groupId');
    if (urlDeviceIds.length > 0 || urlGroupIds.length > 0) {
      hasAutoSelected.current = true;
      return;
    }
    const allDeviceIds = Object.keys(devices).map((id) => parseInt(id, 10));
    if (selectedDeviceIds.length === 0) {
      dispatch(devicesActions.selectIds(allDeviceIds));
    }
    updateReportParams(searchParams, setSearchParams, 'deviceId', allDeviceIds);
    hasAutoSelected.current = true;
  }, [devices, selectedDeviceIds, searchParams, setSearchParams, dispatch]);

  // Aggregate stats for the selected trips, localized via formatter helpers.
  const totalDistance = selectedItems.reduce((sum, item) => sum + (item.distance || 0), 0);
  const totalDuration = selectedItems.reduce((sum, item) => sum + (item.duration || 0), 0);
  const totalAverageSpeed = selectedItems.reduce((sum, item) => sum + (item.averageSpeed || 0), 0);
  const averageSpeed = selectedItems.length > 0 ? totalAverageSpeed / selectedItems.length : 0;

  // Fetch a route per selected trip, keyed by deviceId+timestamps so we can
  // cache and avoid re-fetching when the selection set is widened.
  // Fetches happen in parallel batches (rather than serially) so that selecting
  // hundreds of trips finishes in seconds instead of minutes.
  useEffectAsync(async () => {
    const ROUTE_FETCH_BATCH_SIZE = 16;
    const ROUTE_FETCH_ATTEMPTS = 3;
    // Claim this run. Any run started later bumps the id and makes this one
    // stale, at which point we stop fetching and skip the state write.
    routeRequestId.current += 1;
    const requestId = routeRequestId.current;
    const isStale = () => routeRequestId.current !== requestId;

    /* eslint-disable no-await-in-loop */
    // Fetch one trip's route, retrying transient failures with a short backoff.
    // Returns the position array on success (possibly empty for a trip with no
    // points) or null if every attempt failed.
    const fetchRoute = async ({ deviceId, startTime, endTime }) => {
      const query = new URLSearchParams({ deviceId, from: startTime, to: endTime });
      for (let attempt = 1; attempt <= ROUTE_FETCH_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetchOrThrow(`/api/reports/route?${query.toString()}`, {
            headers: { Accept: 'application/json' },
          });
          return await response.json();
        } catch (error) {
          if (attempt === ROUTE_FETCH_ATTEMPTS || isStale()) {
            return null;
          }
          await new Promise((resolve) => {
            setTimeout(resolve, 250 * attempt);
          });
        }
      }
      return null;
    };

    const newRoutes = {};
    const toFetch = [];
    selectedItems.forEach((item) => {
      const routeKey = `${item.deviceId}-${item.startTime}-${item.endTime}`;
      if (routes[routeKey]) {
        // Reuse a successfully cached route from a previous selection. Failed
        // fetches are never cached, so they fall through to toFetch and get
        // retried rather than staying permanently blank.
        newRoutes[routeKey] = routes[routeKey];
      } else {
        toFetch.push({ item, routeKey });
      }
    });

    for (let i = 0; i < toFetch.length; i += ROUTE_FETCH_BATCH_SIZE) {
      // A newer selection has superseded this run: stop early so we neither
      // waste requests nor overwrite fresher data.
      if (isStale()) {
        return undefined;
      }
      const batch = toFetch.slice(i, i + ROUTE_FETCH_BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async ({ item, routeKey }) => [routeKey, await fetchRoute(item)]),
      );
      results.forEach(([key, data]) => {
        // Only cache real results. A null (all attempts failed) is left out so
        // the trip is retried next time instead of being cached as blank --
        // caching the failure is what made sweeps disappear until the user
        // toggled the selection off and on.
        if (data) {
          newRoutes[key] = data;
        }
      });
    }
    /* eslint-enable no-await-in-loop */

    if (isStale()) {
      return undefined;
    }
    setRoutes(newRoutes);
    return undefined;
  }, [selectedItems]);

  const onShow = useCatch(async ({ deviceIds, groupIds, from, to }) => {
    lastShowParams.current = { deviceIds, groupIds, from, to };
    const query = new URLSearchParams({ from, to });
    deviceIds.forEach((deviceId) => query.append('deviceId', deviceId));
    groupIds.forEach((groupId) => query.append('groupId', groupId));
    setLoading(true);
    try {
      const response = await fetchOrThrow(`/api/reports/trips?${query.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      const trips = await response.json();
      setItems(trips);
      // Auto-select all returned trips so the map and stats are populated
      // immediately.
      setSelectedItems(trips);
      // Record that a search completed and which range it covered, so the
      // empty-state message can echo the dates back to the user.
      setShownRange({ from, to });
      setHasShown(true);
    } finally {
      setLoading(false);
    }
  });

  const onExport = useCatch(async () => {
    const sheets = new Map();
    items.forEach((item) => {
      const deviceName = devices[item.deviceId].name;
      if (!sheets.has(deviceName)) {
        sheets.set(deviceName, []);
      }
      const row = {};
      columns.forEach((key) => {
        const header = t(columnsMap.get(key));
        if (key === 'startAddress') {
          row[header] = formatAddress(
            {
              address: item.startAddress,
              latitude: item.startLat,
              longitude: item.startLon,
            },
            coordinateFormat,
          );
        } else if (key === 'endAddress') {
          row[header] = formatAddress(
            {
              address: item.endAddress,
              latitude: item.endLat,
              longitude: item.endLon,
            },
            coordinateFormat,
          );
        } else {
          row[header] = formatValue(item, key);
        }
      });
      sheets.get(deviceName).push(row);
    });
    await exportExcel(t('reportTrips'), 'trips.xlsx', sheets, theme);
  });

  const onSchedule = useCatch(async (deviceIds, groupIds, report) => {
    report.type = 'trips';
    await scheduleReport(deviceIds, groupIds, report);
    navigate('/reports/scheduled');
  });

  // Data auto-show: on first render, if a deviceId is already in the URL
  // (token-link or shared link) and the period/from/to defaults are ready,
  // auto-fire onShow so the user lands directly on a populated report.
  // Note: relies on v6.12's native "all devices when none selected" behavior;
  // we deliberately do NOT auto-select devices on the user's behalf.
  useEffect(() => {
    if (hasAutoSubmitted.current) return;
    if (!period) return;

    const search = new URLSearchParams(window.location.search);
    const urlDeviceIds = search.getAll('deviceId').map((id) => parseInt(id, 10)).filter(Number.isFinite);
    const urlGroupIds = search.getAll('groupId').map((id) => parseInt(id, 10)).filter(Number.isFinite);
    if (urlDeviceIds.length === 0 && urlGroupIds.length === 0) return;

    let selectedFrom;
    let selectedTo;
    switch (period) {
      case 'today':
        selectedFrom = dayjs().startOf('day');
        selectedTo = dayjs().endOf('day');
        break;
      case 'yesterday':
        selectedFrom = dayjs().subtract(1, 'day').startOf('day');
        selectedTo = dayjs().subtract(1, 'day').endOf('day');
        break;
      case 'thisWeek':
        selectedFrom = dayjs().startOf('week');
        selectedTo = dayjs().endOf('day');
        break;
      case 'previousWeek':
        selectedFrom = dayjs().subtract(1, 'week').startOf('week');
        selectedTo = dayjs().subtract(1, 'week').endOf('week');
        break;
      case 'thisMonth':
        selectedFrom = dayjs().startOf('month');
        selectedTo = dayjs().endOf('month');
        break;
      case 'previousMonth':
        selectedFrom = dayjs().subtract(1, 'month').startOf('month');
        selectedTo = dayjs().subtract(1, 'month').endOf('month');
        break;
      default:
        if (!reportFrom || !reportTo) return;
        selectedFrom = dayjs(reportFrom, 'YYYY-MM-DDTHH:mm');
        selectedTo = dayjs(reportTo, 'YYYY-MM-DDTHH:mm');
        break;
    }

    hasAutoSubmitted.current = true;
    onShow({
      deviceIds: urlDeviceIds,
      groupIds: urlGroupIds,
      from: selectedFrom.toISOString(),
      to: selectedTo.toISOString(),
    });
  }, [period, reportFrom, reportTo, onShow]);

  const navigateToReplay = (item) => {
    navigate({
      pathname: '/replay',
      search: new URLSearchParams({
        from: item.startTime,
        to: item.endTime,
        deviceId: item.deviceId,
      }).toString(),
    });
  };

  const formatValue = (item, key) => {
    const value = item[key];
    switch (key) {
      case 'deviceId':
        return devices[value].name;
      case 'startTime':
      case 'endTime':
        return formatTime(value, 'minutes');
      case 'startOdometer':
      case 'endOdometer':
      case 'distance':
        return formatDistance(value, distanceUnit, t);
      case 'averageSpeed':
      case 'maxSpeed':
        return value > 0 ? formatSpeed(value, speedUnit, t) : null;
      case 'duration':
        return formatNumericHours(value, t);
      case 'spentFuel':
        return value > 0 ? formatVolume(value, volumeUnit, t) : null;
      case 'startAddress':
        return (
          <AddressValue
            latitude={item.startLat}
            longitude={item.startLon}
            originalAddress={value}
          />
        );
      case 'endAddress':
        return (
          <AddressValue latitude={item.endLat} longitude={item.endLon} originalAddress={value} />
        );
      default:
        return value;
    }
  };

  return (
    <PageLayout menu={<ReportsMenu />} breadcrumbs={['reportTitle', 'reportTrips']}>
      <div className={classes.container}>
        {selectedItems.length > 0 && (
          <div className={classes.containerMap}>
            <MapView>
              <MapGeofence />
              <MapMultiRoutePath
                routes={Object.values(routes)}
                color={
                  // In dark mode, common track colors clash with map features:
                  // blue/cyan = waterways, orange = highways, green = parks.
                  // Magenta/pink isn't a natural map element, so it reads
                  // unambiguously as user data against any tile background.
                  theme.palette.mode === 'dark' ? '#ec407a' : theme.palette.primary.main
                }
              />
              {Object.values(routes).flat().length > 0 && (
                <MapCamera positions={Object.values(routes).flat()} />
              )}
            </MapView>
            <MapScale />
          </div>
        )}
        <div className={classes.containerMain}>
          <div className={classes.header}>
            <ReportFilter
              onShow={onShow}
              onExport={onExport}
              onSchedule={onSchedule}
              deviceType="multiple"
              loading={loading}
              disableGroups
            />
            {selectedItems.length > 0 && (
              <Box
                sx={{
                  mt: 2,
                  p: 2,
                  bgcolor: 'background.paper',
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                  <Typography variant="body1" color="text.secondary">
                    {`${selectedItems.length}/${items.length} ${t('sharedSelected')}`}
                    {'  |  '}
                    {`${t('tripTotalDistance')}: ${formatDistance(totalDistance, distanceUnit, t)}`}
                    {'  |  '}
                    {`${t('tripTotalDuration')}: ${formatNumericHours(totalDuration, t)}`}
                    {'  |  '}
                    {`${t('tripAverageSpeed')}: ${averageSpeed > 0 ? formatSpeed(averageSpeed, speedUnit, t) : '-'}`}
                  </Typography>
                </Box>
              </Box>
            )}
          </div>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell className={classes.columnAction} padding="checkbox">
                  <Checkbox
                    indeterminate={selectedItems.length > 0 && selectedItems.length < items.length}
                    checked={items.length > 0 && selectedItems.length === items.length}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelectedItems([...items]);
                      } else {
                        setSelectedItems([]);
                      }
                    }}
                  />
                </TableCell>
                <TableCell>{t('sharedDevice')}</TableCell>
                {columns.map((key) => (
                  <TableCell key={key}>{t(columnsMap.get(key))}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableShimmer columns={columns.length + 2} startAction />
              )}
              {!loading && hasShown && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length + 2} align="center" sx={{ py: 4, border: 0 }}>
                    <Typography variant="body2" color="text.secondary">
                      {t('reportNoSweepsInRange', {
                        from: dayjs(shownRange?.from).format('YYYY-MM-DD hh:mm A'),
                        to: dayjs(shownRange?.to).format('YYYY-MM-DD hh:mm A'),
                      })}
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.length > 0 && items.map((item) => {
                const isSelected = selectedItems.some(
                  (selected) => selected.startPositionId === item.startPositionId,
                );
                return (
                  <TableRow key={item.startPositionId} selected={isSelected}>
                    <TableCell className={classes.columnAction} padding="checkbox">
                      <div className={classes.columnActionContainer}>
                        <Checkbox
                          checked={isSelected}
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelectedItems([...selectedItems, item]);
                            } else {
                              setSelectedItems(
                                selectedItems.filter(
                                  (selected) => selected.startPositionId !== item.startPositionId,
                                ),
                              );
                            }
                          }}
                        />
                        {isSelected && selectedItems.length === 1 ? (
                          <IconButton size="small" onClick={() => setSelectedItems([])}>
                            <GpsFixedIcon fontSize="small" />
                          </IconButton>
                        ) : (
                          <IconButton size="small" onClick={() => setSelectedItems([item])}>
                            <LocationSearchingIcon fontSize="small" />
                          </IconButton>
                        )}
                        <IconButton size="small" onClick={() => navigateToReplay(item)}>
                          <RouteIcon fontSize="small" />
                        </IconButton>
                      </div>
                    </TableCell>
                    <TableCell>{devices[item.deviceId].name}</TableCell>
                    {columns.map((key) => (
                      <TableCell key={key}>{formatValue(item, key)}</TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </PageLayout>
  );
};

export default TripReportPage;
