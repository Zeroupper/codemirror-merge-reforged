import { useState } from "react";
import MergeViewDemo from "./MergeViewDemo";
import PerformanceTest from "./PerformanceDemo";
import React from "react";

function App() {
  const [currentView, setCurrentView] = useState<"demo" | "performance">(
    "demo"
  );

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-content">
          <h1 className="header-title">
            CodeMirror Merge View
          </h1>
          <nav className="nav">
            <button
              onClick={() => setCurrentView("demo")}
              className={`nav-button ${
                currentView === "demo" ? "active" : "inactive"
              }`}
            >
              Merge Demo
            </button>
            <button
              onClick={() => setCurrentView("performance")}
              className={`nav-button ${
                currentView === "performance" ? "active" : "inactive"
              }`}
            >
              Performance Test
            </button>
          </nav>
        </div>
      </header>

      <main className="main-content">
        {currentView === "demo" ? <MergeViewDemo /> : <PerformanceTest />}
      </main>
    </div>
  );
}

export default App;