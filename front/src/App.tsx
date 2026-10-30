import { useState } from "react";
import { FlightLookup } from "./components/FlightLookup";
import { ChatWidget } from "./components/ChatWidget";
import type { Flight } from "./types/flight";
import "./App.css";

function App() {
  const [activeFlight, setActiveFlight] = useState<Flight | null>(null);

  return (
    <>
      <FlightLookup onFlightFound={(flight) => setActiveFlight(flight)} />
      {activeFlight && (
        <ChatWidget key={`${activeFlight.flight_number}-${activeFlight.date}`} flight={activeFlight} />
      )}
    </>
  );
}

export default App;
