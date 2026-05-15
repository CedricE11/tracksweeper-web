import { useTheme } from '@mui/material/styles';
import { useId, useEffect } from 'react';
import { map } from './core/MapView';
import { useAttributePreference } from '../common/util/preferences';

// Renders many routes as a SINGLE MapLibre source/layer to keep rendering cost
// constant regardless of how many trips the user has selected. Each route
// becomes one Feature in the underlying FeatureCollection.
//
// Used by the trips report when a single fixed color is desired. For variable
// (per-segment, speed-based) coloring, use the existing MapRoutePath instead.
const MapMultiRoutePath = ({ routes, color }) => {
  const id = useId();
  const theme = useTheme();

  const mapLineWidth = useAttributePreference('mapLineWidth', 2);
  const mapLineOpacity = useAttributePreference('mapLineOpacity', 1);

  useEffect(() => {
    map.addSource(id, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [],
      },
    });
    map.addLayer({
      source: id,
      id: `${id}-line`,
      type: 'line',
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'width'],
        'line-opacity': ['get', 'opacity'],
      },
    });

    return () => {
      if (map.getLayer(`${id}-line`)) {
        map.removeLayer(`${id}-line`);
      }
      if (map.getSource(id)) {
        map.removeSource(id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const features = (routes || [])
      .filter((positions) => positions && positions.length >= 2)
      .map((positions) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: positions.map((p) => [p.longitude, p.latitude]),
        },
        properties: {
          color: color || theme.palette.primary.main,
          width: mapLineWidth,
          opacity: mapLineOpacity,
        },
      }));
    map.getSource(id)?.setData({
      type: 'FeatureCollection',
      features,
    });
  }, [theme, routes, color, mapLineWidth, mapLineOpacity, id]);

  return null;
};

export default MapMultiRoutePath;
