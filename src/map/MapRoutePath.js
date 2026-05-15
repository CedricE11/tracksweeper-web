import { useTheme } from '@mui/material/styles';
import { useId, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { map } from './core/MapView';
import getSpeedColor from '../common/util/colors';
import { useAttributePreference } from '../common/util/preferences';

const MapRoutePath = ({ positions, color }) => {
  const id = useId();

  const theme = useTheme();

  const reportColor = useSelector((state) => {
    const position = positions?.find(() => true);
    if (position) {
      const attributes = state.devices.items[position.deviceId]?.attributes;
      if (attributes) {
        const color = attributes['web.reportColor'];
        if (color) {
          return color;
        }
      }
    }
    return null;
  });

  const mapLineWidth = useAttributePreference('mapLineWidth', 2);
  const mapLineOpacity = useAttributePreference('mapLineOpacity', 1);

  useEffect(() => {
    map.addSource(id, {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [],
        },
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
  }, []);

  useEffect(() => {
    const fixedColor = color || reportColor;
    let features;
    if (fixedColor) {
      // Single-color path: emit one LineString feature for the whole route.
      // This is dramatically cheaper than per-segment rendering when many
      // routes are drawn at once (e.g. trip report with hundreds of trips).
      features = [{
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: positions.map((p) => [p.longitude, p.latitude]),
        },
        properties: {
          color: fixedColor,
          width: mapLineWidth,
          opacity: mapLineOpacity,
        },
      }];
    } else {
      // Speed-colored path: one feature per segment, colored by speed.
      const minSpeed = positions.map((p) => p.speed).reduce((a, b) => Math.min(a, b), Infinity);
      const maxSpeed = positions.map((p) => p.speed).reduce((a, b) => Math.max(a, b), -Infinity);
      features = [];
      for (let i = 0; i < positions.length - 1; i += 1) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [positions[i].longitude, positions[i].latitude],
              [positions[i + 1].longitude, positions[i + 1].latitude],
            ],
          },
          properties: {
            color: getSpeedColor(positions[i + 1].speed, minSpeed, maxSpeed),
            width: mapLineWidth,
            opacity: mapLineOpacity,
          },
        });
      }
    }
    map.getSource(id)?.setData({
      type: 'FeatureCollection',
      features,
    });
  }, [theme, positions, reportColor, color, mapLineWidth, mapLineOpacity]);

  return null;
};

export default MapRoutePath;
