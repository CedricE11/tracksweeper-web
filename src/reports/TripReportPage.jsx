import {
  useState, Fragment, useEffect, useRef,
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
import { interpolateTurbo } from '../common/util/colors';
import { speedFromKnots, speedUnitString } from '../common/util/converter';
import ReportFilter, { updateReportParams } from './components/ReportFilter';
import { useAttributePreference, usePreference } from '../common/util/preferences';
import { useTranslation } from '../common/components/LocalizationProvider';
import PageLayout from '../common/components/PageLayout';
import ReportsMenu from './components/ReportsMenu';
import ColumnSelect from './components/ColumnSelect';
import usePersistedState from '../common/util/usePersistedState';
import { useCatch, useEffectAsync } from '../reactHelper';
import { devicesActions } from '../store';
import useReportStyles from './common/useReportStyles';
import MapView from '../map/core/MapView';
import MapRoutePath from '../map/MapRoutePath';
import AddressValue from '../common/components/AddressValue';
import TableShimmer from '../common/components/TableShimmer';
import MapMarkers from '../map/MapMarkers';
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

  const [columns, setColumns] = usePersistedState('tripColumns', [
    'startTime',
    'endTime',
    'distance',
    'averageSpeed',
  ]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  // Multi-trip selection state: array of selected trip rows.
  const [selectedItems, setSelectedItems] = useState([]);
  // Map of routeKey -> array of route positions for every selected trip.
  const [routes, setRoutes] = useState({});
  const hasAutoSubmitted = useRef(false);
  const lastShowParams = useRef(null);


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

  // Speed-scale legend: derive a 5-stop turbo-color gradient from the actual
  // speed range present in the visible routes.
  const allSpeeds = Object.values(routes)
    .flat()
    .map((pos) => pos.speed)
    .filter((speed) => speed != null && speed > 0);
  const minSpeed = allSpeeds.length > 0 ? Math.min(...allSpeeds) : 0;
  const maxSpeed = allSpeeds.length > 0 ? Math.max(...allSpeeds) : 0;

  const createSpeedScale = () => {
    if (minSpeed === 0 && maxSpeed === 0) return [];
    const scalePoints = 5;
    const scaleItems = [];
    for (let i = 0; i < scalePoints; i += 1) {
      const speed = minSpeed + (maxSpeed - minSpeed) * (i / (scalePoints - 1));
      const normalized = maxSpeed === minSpeed ? 0 : (speed - minSpeed) / (maxSpeed - minSpeed);
      const color = interpolateTurbo(normalized);
      scaleItems.push({ speed, color });
    }
    return scaleItems;
  };

  const speedScaleItems = createSpeedScale();

  // Markers for every selected trip (start + end), so multiple trips show at
  // once on the map.
  const createMarkers = () => {
    const markers = [];
    selectedItems.forEach((item) => {
      markers.push(
        {
          latitude: item.startLat,
          longitude: item.startLon,
          image: 'start-success',
        },
        {
          latitude: item.endLat,
          longitude: item.endLon,
          image: 'finish-error',
        },
      );
    });
    return markers;
  };

  // Fetch a route per selected trip, keyed by deviceId+timestamps so we can
  // cache and avoid re-fetching when the selection set is widened.
  useEffectAsync(async () => {
    const newRoutes = {};
    /* eslint-disable no-await-in-loop */
    for (const item of selectedItems) {
      const routeKey = `${item.deviceId}-${item.startTime}-${item.endTime}`;
      if (routes[routeKey]) {
        newRoutes[routeKey] = routes[routeKey];
      } else {
        const query = new URLSearchParams({
          deviceId: item.deviceId,
          from: item.startTime,
          to: item.endTime,
        });
        try {
          const response = await fetchOrThrow(`/api/reports/route?${query.toString()}`, {
            headers: { Accept: 'application/json' },
          });
          newRoutes[routeKey] = await response.json();
        } catch (error) {
          // Swallow per-trip route failures so a single bad trip doesn't break
          // the rest of the visualization.
          newRoutes[routeKey] = [];
        }
      }
    }
    /* eslint-enable no-await-in-loop */
    setRoutes(newRoutes);
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
              {Object.entries(routes).map(([key, positions]) => (
                <MapRoutePath key={key} positions={positions} />
              ))}
              <MapMarkers markers={createMarkers()} />
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
            >
              <ColumnSelect columns={columns} setColumns={setColumns} columnsArray={columnsArray} />
            </ReportFilter>
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
                  {speedScaleItems.length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        {`${t('tripSpeedScale')} (${speedUnitString(speedUnit, t)}):`}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {speedScaleItems.map((item, index) => (
                          <Fragment key={`${item.speed}-${index}`}>
                            <Box
                              sx={{
                                width: 12,
                                height: 12,
                                backgroundColor: `rgb(${item.color[0]}, ${item.color[1]}, ${item.color[2]})`,
                                borderRadius: 1,
                              }}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {Math.round(speedFromKnots(item.speed, speedUnit))}
                            </Typography>
                            {index < speedScaleItems.length - 1 && (
                              <Typography variant="caption" color="text.secondary">,</Typography>
                            )}
                          </Fragment>
                        ))}
                      </Box>
                    </Box>
                  )}
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
              {!loading ? (
                items.map((item) => {
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
                })
              ) : (
                <TableShimmer columns={columns.length + 2} startAction />
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </PageLayout>
  );
};

export default TripReportPage;
