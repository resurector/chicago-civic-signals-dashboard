import { useEffect, useMemo, useState } from 'react';
import CityMap from './components/CityMap.jsx';
import SignalPanel from './components/SignalPanel.jsx';
import { compact, dateLabel, number } from './lib/format.js';

const DATA_URL = `${import.meta.env.BASE_URL}data/civic-signals.json`;
const GEO_URL = `${import.meta.env.BASE_URL}data/community-areas.geojson`;

export default function App() {
  const [data, setData] = useState(null);
  const [geo, setGeo] = useState(null);
  const [error, setError] = useState(null);
  const [mapMode, setMapMode] = useState('disorder');
  const [selectedArea, setSelectedArea] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch(DATA_URL).then((r) => {
        if (!r.ok) throw new Error(`data ${r.status}`);
        return r.json();
      }),
      fetch(GEO_URL).then((r) => {
        if (!r.ok) throw new Error(`geojson ${r.status}`);
        return r.json();
      }),
    ])
      .then(([d, g]) => {
        setData(d);
        setGeo(g);
      })
      .catch((e) => setError(e.message));
  }, []);

  const selected = useMemo(() => {
    if (!selectedArea || !data) return null;
    return data.communityAreas.find((area) => area.number === selectedArea) ?? null;
  }, [data, selectedArea]);

  if (error) {
    return <main className="load-state">Could not load static data: {error}</main>;
  }

  if (!data || !geo) {
    return <main className="load-state">Loading static graph export...</main>;
  }

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">Chicago crime graph / civic signals</p>
          <h1>Before Crime Shows Up</h1>
          <p className="lede">
            A static dashboard connecting 311 disorder reports, later crime activity, and CTA station
            catchments from a local Neo4j graph export.
          </p>
          <p className="date-range">
            Data window: {dateLabel(data.meta.earliest)} to {dateLabel(data.meta.latest)}
          </p>
        </div>
        <div className="hero-stats" aria-label="Dataset summary">
          <Stat label="crimes" value={compact(data.meta.totalCrimes)} />
          <Stat label="311 requests" value={compact(data.meta.total311)} />
          <Stat label="CTA stations" value={number(data.meta.stations)} />
        </div>
      </header>

      <section className="workspace">
        <div className="map-shell">
          <div className="section-head">
            <div>
              <h2>City Map</h2>
              <p>{selected ? `${selected.name}, CA ${selected.number}` : 'Select a community area'}</p>
            </div>
            <div className="segmented">
              <button
                type="button"
                className={mapMode === 'disorder' ? 'active' : ''}
                onClick={() => setMapMode('disorder')}
              >
                311 disorder
              </button>
              <button
                type="button"
                className={mapMode === 'crime' ? 'active' : ''}
                onClick={() => setMapMode('crime')}
              >
                Crime volume
              </button>
              <button
                type="button"
                className={mapMode === 'ratio' ? 'active' : ''}
                onClick={() => setMapMode('ratio')}
              >
                Disorder ratio
              </button>
            </div>
          </div>
          <CityMap
            geo={geo}
            areas={data.communityAreas}
            mode={mapMode}
            selectedArea={selectedArea}
            onSelectArea={setSelectedArea}
          />
        </div>

        <SignalPanel data={data} selected={selected} />
      </section>

      <section className="explainer">
        <div className="section-head compact">
          <div>
            <h2>How to Read This Dashboard</h2>
            <p>Each layer is a different way of looking at the same city graph.</p>
          </div>
        </div>
        <div className="explainer-grid">
          <ExplainerCard
            title="311 Disorder"
            text="Resident service requests tied to visible civic conditions such as graffiti, abandoned vehicles, garbage issues, rodents, sanitation complaints, vacant buildings, weeds, and vacant-lot cleanup."
          />
          <ExplainerCard
            title="Crime Volume"
            text="The count of crime records connected to each community area through block relationships in the Neo4j graph."
          />
          <ExplainerCard
            title="Disorder Ratio"
            text="Disorder-related 311 requests per 1,000 crimes. A high value means civic-condition reports are large relative to recorded crime, not necessarily that the area is more dangerous."
          />
          <ExplainerCard
            title="Disorder Before Later Crime"
            text={`Blocks are grouped by disorder 311 calls before ${data.meta.splitDate}. The bar shows the average number of crimes on those same blocks after that split date.`}
          />
          <ExplainerCard
            title="Transit Catchments"
            text="CTA station areas are built from blocks near each station. The ranking compares nearby disorder 311 requests with nearby crimes."
          />
          <ExplainerCard
            title="Three-Layer Blocks"
            text="Specific blocks where three graph layers intersect: a nearby CTA station, prior disorder 311 reports, and later crime records."
          />
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ExplainerCard({ title, text }) {
  return (
    <article className="explainer-card">
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}
