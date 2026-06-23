import { Divider, List } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import TimelineIcon from '@mui/icons-material/Timeline';
import PauseCircleFilledIcon from '@mui/icons-material/PauseCircleFilled';
import PlayCircleFilledIcon from '@mui/icons-material/PlayCircleFilled';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import PlaceIcon from '@mui/icons-material/Place';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import BarChartIcon from '@mui/icons-material/BarChart';
import RouteIcon from '@mui/icons-material/Route';
import EventRepeatIcon from '@mui/icons-material/EventRepeat';
import NotesIcon from '@mui/icons-material/Notes';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import { useLocation } from 'react-router-dom';
import { useTranslation } from '../../common/components/LocalizationProvider';
import { useAdministrator, useRestriction } from '../../common/util/permissions';
import MenuItem from '../../common/components/MenuItem';
import useVisibleReports from '../../common/util/useVisibleReports';

const ReportsMenu = () => {
  const t = useTranslation();
  const location = useLocation();

  const admin = useAdministrator();
  const readonly = useRestriction('readonly');

  const visibleReports = useVisibleReports();

  // If the user has explicitly hidden every report, render nothing
  // (preserves the "deselect all" UX from the original sweeper customization).
  if (visibleReports.length === 0) {
    return null;
  }

  const buildLink = (path) => {
    const sourceParams = new URLSearchParams(location.search);
    const deviceIds = sourceParams.getAll('deviceId');
    const groupIds = sourceParams.getAll('groupId');
    if (!deviceIds.length && !groupIds.length) {
      return path;
    }
    const params = new URLSearchParams();
    if (path === '/reports/chart' || path === '/reports/route' || path === '/replay') {
      const [firstDeviceId] = deviceIds;
      if (firstDeviceId != null) {
        params.append('deviceId', firstDeviceId);
      }
    } else {
      deviceIds.forEach((deviceId) => params.append('deviceId', deviceId));
      groupIds.forEach((groupId) => params.append('groupId', groupId));
    }
    const search = params.toString();
    return search ? `${path}?${search}` : path;
  };

  return (
    <>
      <List>
        {visibleReports.includes('combined') && (
          <MenuItem
            title={t('reportCombined')}
            link={buildLink('/reports/combined')}
            icon={<StarIcon />}
            selected={location.pathname === '/reports/combined'}
          />
        )}
        {visibleReports.includes('events') && (
          <MenuItem
            title={t('reportEvents')}
            link={buildLink('/reports/events')}
            icon={<NotificationsActiveIcon />}
            selected={location.pathname === '/reports/events'}
          />
        )}
        {visibleReports.includes('geofences') && (
          <MenuItem
            title={t('sharedGeofences')}
            link={buildLink('/reports/geofences')}
            icon={<PlaceIcon />}
            selected={location.pathname === '/reports/geofences'}
          />
        )}
        {visibleReports.includes('trips') && (
          <MenuItem
            title={t('reportTrips')}
            link={buildLink('/reports/trips')}
            icon={<PlayCircleFilledIcon />}
            selected={location.pathname === '/reports/trips'}
          />
        )}
        {visibleReports.includes('stops') && (
          <MenuItem
            title={t('reportStops')}
            link={buildLink('/reports/stops')}
            icon={<PauseCircleFilledIcon />}
            selected={location.pathname === '/reports/stops'}
          />
        )}
        {visibleReports.includes('summary') && (
          <MenuItem
            title={t('reportSummary')}
            link={buildLink('/reports/summary')}
            icon={<FormatListBulletedIcon />}
            selected={location.pathname === '/reports/summary'}
          />
        )}
        {visibleReports.includes('chart') && (
          <MenuItem
            title={t('reportChart')}
            link={buildLink('/reports/chart')}
            icon={<TrendingUpIcon />}
            selected={location.pathname === '/reports/chart'}
          />
        )}
        {visibleReports.includes('replay') && (
          <MenuItem title={t('reportReplay')} link={buildLink('/replay')} icon={<RouteIcon />} />
        )}
        {visibleReports.includes('route') && (
          <MenuItem
            title={t('reportPositions')}
            link={buildLink('/reports/route')}
            icon={<TimelineIcon />}
            selected={location.pathname === '/reports/route'}
          />
        )}
      </List>
      <Divider />
      <List>
        {visibleReports.includes('logs') && (
          <MenuItem
            title={t('sharedLogs')}
            link="/reports/logs"
            icon={<NotesIcon />}
            selected={location.pathname === '/reports/logs'}
          />
        )}
        {!readonly && visibleReports.includes('scheduled') && (
          <MenuItem
            title={t('reportScheduled')}
            link="/reports/scheduled"
            icon={<EventRepeatIcon />}
            selected={location.pathname === '/reports/scheduled'}
          />
        )}
        {admin && visibleReports.includes('statistics') && (
          <MenuItem
            title={t('statisticsTitle')}
            link="/reports/statistics"
            icon={<BarChartIcon />}
            selected={location.pathname === '/reports/statistics'}
          />
        )}
        {admin && (
          <MenuItem
            title={t('reportAudit')}
            link="/reports/audit"
            icon={<VerifiedUserIcon />}
            selected={location.pathname === '/reports/audit'}
          />
        )}
      </List>
    </>
  );
};

export default ReportsMenu;
