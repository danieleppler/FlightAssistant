import { useRef, useState } from "react";
import { FlightLookup } from "./components/FlightLookup";
import { ChatWidget } from "./components/ChatWidget";
import type { Flight } from "./types/flight";
import "./App.css";

function App() {
  const [activeFlight, setActiveFlight] = useState<Flight | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  function handleFlightFound(flight: Flight, _date: string, trigger: HTMLElement) {
    triggerRef.current = trigger;
    setActiveFlight(flight);
  }

  function handleClose() {
    setActiveFlight(null);
    triggerRef.current?.focus();
  }

  return (
    <>
      <FlightLookup onFlightFound={handleFlightFound} />
      {activeFlight && (
        <ChatWidget
          key={`${activeFlight.flight_number}-${activeFlight.date}`}
          flight={activeFlight}
          onClose={handleClose}
        />
      )}
    </>
  );
}

export default App;
