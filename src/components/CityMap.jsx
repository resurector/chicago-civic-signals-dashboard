import { useMemo, useState } from 'react';
import * as d3 from 'd3';
import { number } from '../lib/format.js';

const CLUSTER_COLORS = new Map([
  [5, '#b66e16'],
  [17, '#148263'],
  [45, '#cf4f2c'],
  [50, '#6d65d8'],
]);

export default function CityMap({ geo, areas, mode, selectedArea, onSelectArea }) {
  const [tooltip, setTooltip] = useState(null);
  const areaByNumber = useMemo(() => new Map(areas.map((area) => [area.number, area])), [areas]);

  const scales = useMemo(() => {
    const crimeMax = d3.quantile(
      areas.map((a) => a.crimes).sort((a, b) => a - b),
      0.94
    );
    const disorderMax = d3.quantile(
      areas.map((a) => a.disorder311).sort((a, b) => a - b),
      0.94
    );
    const ratioMax = d3.quantile(
      areas.map((a) => a.disorderPer1kCrimes).sort((a, b) => a - b),
      0.92
    );

    return {
      crime: d3.scaleSequential([0, crimeMax || 1], d3.interpolateBlues).clamp(true),
      disorder: d3.scaleSequential([0, disorderMax || 1], d3.interpolateYlOrRd).clamp(true),
      ratio: d3.scaleSequential([0, ratioMax || 1], d3.interpolatePuRd).clamp(true),
    };
  }, [areas]);

  const { paths, viewBox } = useMemo(() => {
    const width = 660;
    const height = 760;
    const projection = d3.geoMercator().fitSize([width - 24, height - 24], geo);
    const path = d3.geoPath(projection);

    const features = geo.features.map((feature) => {
      const rawNumber =
        feature.properties.area_numbe ??
        feature.properties.area_num_1 ??
        feature.properties.AREA_NUMBE;
      const communityName = feature.properties.community ?? feature.properties.COMMUNITY ?? '';
      const areaNumber = rawNumber != null ? parseInt(rawNumber, 10) : null;
      const area = areaNumber != null ? areaByNumber.get(areaNumber) : null;
      return {
        area,
        areaNumber,
        name: area?.name ?? communityName,
        d: path(feature),
        centroid: path.centroid(feature),
        visualArea: path.area(feature),
      };
    });

    return { paths: features, viewBox: `0 0 ${width} ${height}` };
  }, [geo, areaByNumber]);

  function fillFor(area) {
    if (!area) return '#d8d3c8';
    if (mode === 'cluster') return CLUSTER_COLORS.get(area.cluster) ?? '#9aa2a7';
    if (mode === 'crime') return scales.crime(area.crimes);
    if (mode === 'ratio') return scales.ratio(area.disorderPer1kCrimes);
    return scales.disorder(area.disorder311);
  }

  function activeMetric(area) {
    if (!area) return null;
    if (mode === 'crime') return { label: 'Crimes', value: number(area.crimes) };
    if (mode === 'ratio') {
      return { label: 'Disorder per 1,000 crimes', value: number(area.disorderPer1kCrimes) };
    }
    if (mode === 'cluster') return { label: 'Crime cluster', value: area.cluster ?? 'n/a' };
    return { label: '311 disorder', value: number(area.disorder311) };
  }

  function titleFor(area, name, numberValue) {
    if (!area) return `${name} (CA ${numberValue})`;
    const lines = [`${area.name} (CA ${area.number})`];

    if (mode === 'crime') {
      lines.push(`${number(area.crimes)} crimes`);
      lines.push(`${number(area.disorder311)} disorder 311`);
    } else if (mode === 'ratio') {
      lines.push(`${number(area.disorderPer1kCrimes)} disorder per 1,000 crimes`);
      lines.push(`${number(area.crimes)} crimes`);
    } else if (mode === 'cluster') {
      lines.push(`crime cluster ${area.cluster}`);
      lines.push(`${number(area.crimes)} crimes`);
    } else {
      lines.push(`${number(area.disorder311)} disorder 311`);
      lines.push(`${number(area.crimes)} crimes`);
    }

    if (mode !== 'ratio') {
      lines.push(`${number(area.disorderPer1kCrimes)} disorder per 1,000 crimes`);
    }

    return lines.join(' | ');
  }

  return (
    <div className="map-wrap">
      <svg className="city-map" viewBox={viewBox} role="img" aria-label="Chicago community area map">
        {paths.map((path) => {
          const isSelected = selectedArea === path.areaNumber;
          const className = ['map-area', isSelected ? 'selected' : ''].filter(Boolean).join(' ');
          const metric = activeMetric(path.area);
          return (
            <path
              key={path.areaNumber}
              d={path.d}
              fill={fillFor(path.area)}
              className={className}
              tabIndex={0}
              role="button"
              aria-label={titleFor(path.area, path.name, path.areaNumber)}
              onClick={() => onSelectArea(isSelected ? null : path.areaNumber)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectArea(isSelected ? null : path.areaNumber);
                }
              }}
              onMouseMove={(event) => {
                if (!path.area || !metric) return;
                setTooltip({
                  x: event.clientX,
                  y: event.clientY,
                  name: path.area.name,
                  number: path.area.number,
                  metric,
                  crimes: path.area.crimes,
                  disorder: path.area.disorder311,
                  ratio: path.area.disorderPer1kCrimes,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
              onFocus={() => {
                if (!path.area || !metric) return;
                setTooltip({
                  x: window.innerWidth / 2,
                  y: 180,
                  name: path.area.name,
                  number: path.area.number,
                  metric,
                  crimes: path.area.crimes,
                  disorder: path.area.disorder311,
                  ratio: path.area.disorderPer1kCrimes,
                });
              }}
              onBlur={() => setTooltip(null)}
            >
              <title>{titleFor(path.area, path.name, path.areaNumber)}</title>
            </path>
          );
        })}

        {paths
          .filter((path) => path.visualArea > 3000 && path.name)
          .map((path) => (
            <text
              key={`label-${path.areaNumber}`}
              className="map-label"
              x={path.centroid[0]}
              y={path.centroid[1]}
              pointerEvents="none"
            >
              {path.name}
            </text>
          ))}
      </svg>

      <div className="map-legend">
        {mode === 'cluster' ? (
          [...CLUSTER_COLORS.entries()].map(([cluster, color]) => (
            <span className="cluster-key" key={cluster}>
              <i style={{ background: color }} />
              Cluster {cluster}
            </span>
          ))
        ) : (
          <>
            <span>Lower</span>
            <span className={`legend-ramp ${mode}`} />
            <span>Higher</span>
          </>
        )}
      </div>

      {tooltip && (
        <div
          className="map-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
        >
          <strong>{tooltip.name}</strong>
          <span>CA {tooltip.number}</span>
          <div className="tooltip-metric">
            <em>{tooltip.metric.label}</em>
            <b>{tooltip.metric.value}</b>
          </div>
          <small>
            {number(tooltip.crimes)} crimes / {number(tooltip.disorder)} disorder 311 /{' '}
            {number(tooltip.ratio)} per 1k crimes
          </small>
        </div>
      )}
    </div>
  );
}
