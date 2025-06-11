import { useState } from "react";
import MergeViewDemo from "./MergeViewDemo";
import PerformanceTest from "./PerformanceDemo";
import React from "react";

function App() {
  const [currentView, setCurrentView] = useState<"demo" | "performance">(
    "demo"
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">
              CodeMirror Merge View
            </h1>
            <nav className="flex gap-4">
              <button
                onClick={() => setCurrentView("demo")}
                className={`px-4 py-2 rounded ${
                  currentView === "demo"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                Merge Demo
              </button>
              <button
                onClick={() => setCurrentView("performance")}
                className={`px-4 py-2 rounded ${
                  currentView === "performance"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                Performance Test
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentView === "demo" ? <MergeViewDemo /> : <PerformanceTest />}
      </main>
    </div>
  );
}

export default App;
