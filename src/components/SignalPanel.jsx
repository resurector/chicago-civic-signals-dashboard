import { compact, money, number } from '../lib/format.js';

export default function SignalPanel({ data, selected }) {
  const topRequestTypes = data.requestTypes.filter((row) => row.category === 'disorder').slice(0, 8);
  const highRatioAreas = [...data.communityAreas]
    .filter((area) => area.crimes >= 300 && area.disorder311 >= 300)
    .sort((a, b) => b.disorderPer1kCrimes - a.disorderPer1kCrimes)
    .slice(0, 8);

  return (
    <aside className="signal-panel">
      <section className="detail-card selected-card">
        <div className="section-head compact">
          <div>
            <h2>{selected ? selected.name : 'Civic Signal Detail'}</h2>
            <p>{selected ? `Community area ${selected.number}` : 'Click the map to inspect a place'}</p>
          </div>
        </div>
        {selected ? (
          <div className="selected-grid">
            <Metric label="crimes" value={number(selected.crimes)} />
            <Metric label="disorder 311" value={number(selected.disorder311)} />
            <Metric label="per 1k crimes" value={number(selected.disorderPer1kCrimes)} />
            <Metric label="median income" value={money(selected.medianIncome)} />
          </div>
        ) : (
          <p className="muted">
            The map is a static export from Neo4j. It can be hosted on GitHub Pages without a running database.
          </p>
        )}
      </section>

      <section className="detail-card">
        <h2>Disorder Before Later Crime</h2>
        <div className="bin-chart">
          {data.disorderBins.map((row) => (
            <div className="bin-row" key={row.bin}>
              <span className="bin-label">{row.bin}</span>
              <span className="bar-track">
                <span
                  className="bar-fill"
                  style={{ width: `${Math.min(100, row.avgLateCrimes * 34)}%` }}
                />
              </span>
              <strong>{row.avgLateCrimes.toFixed(2)}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="detail-card split-card">
        <ListBlock title="High Disorder Areas" rows={highRatioAreas}>
          {(row) => (
            <>
              <span>{row.name}</span>
              <strong>{number(row.disorderPer1kCrimes)}</strong>
            </>
          )}
        </ListBlock>

        <ListBlock title="311 Disorder Types" rows={topRequestTypes}>
          {(row) => (
            <>
              <span>{row.type}</span>
              <strong>{compact(row.count)}</strong>
            </>
          )}
        </ListBlock>
      </section>

      <section className="detail-card">
        <h2>Transit Catchments</h2>
        <div className="rank-list">
          {data.stationCatchments.slice(0, 9).map((row) => (
            <div className="rank-row" key={`${row.mapId}-${row.name}`}>
              <span>{row.name}</span>
              <strong>{row.disorderToCrimeRatio.toFixed(2)}x</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="detail-card">
        <h2>Three-Layer Blocks</h2>
        <div className="block-list">
          {data.threeLayerBlocks.slice(0, 6).map((row) => (
            <article key={row.block} className="block-row">
              <strong>{row.block}</strong>
              <span>{row.stations.join(', ')}</span>
              <small>
                {row.priorDisorder} prior disorder 311 / {row.laterCrimes} later crimes
              </small>
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ListBlock({ title, rows, children }) {
  return (
    <div>
      <h2>{title}</h2>
      <div className="rank-list">
        {rows.map((row, index) => (
          <div className="rank-row" key={`${title}-${index}`}>
            {children(row)}
          </div>
        ))}
      </div>
    </div>
  );
}
