import { useSelector } from 'react-redux';

// Stable identifiers persisted in user.attributes.visibleReports.
// Must match the values offered in the UserPage / PreferencesPage settings.
export const ALL_REPORTS = [
  'combined', 'events', 'geofences', 'trips', 'stops',
  'summary', 'chart', 'replay', 'route',
  'logs', 'scheduled', 'statistics',
];

// Parses the comma-separated visibleReports attribute into a normalized array.
// Returns ALL_REPORTS when unset (default), [] when explicitly cleared.
const useVisibleReports = () => {
  const raw = useSelector((state) => state.session.user?.attributes?.visibleReports);
  if (raw === undefined || raw === null) {
    return ALL_REPORTS;
  }
  if (raw === '' || raw === 'none') {
    return [];
  }
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
};

export default useVisibleReports;
