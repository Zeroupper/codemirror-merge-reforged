import React, { useState, useEffect, useRef } from "react";
import Container from "./components/Container";
import Button from "./components/Button";
import { createTestConfigs } from "./performance/testConfigs";
import { executeTest, cleanupTest } from "./performance/testUtils";
import { TestResult, ActiveTest } from "./performance/types";

const PerformanceTest: React.FC = () => {
  const [editorCount, setEditorCount] = useState(10);
  const [isRunning, setIsRunning] = useState(false);
  const [currentTest, setCurrentTest] = useState<string>("");
  const [results, setResults] = useState<TestResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [activeTest, setActiveTest] = useState<ActiveTest | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const testConfigs = createTestConfigs();

  const runSingleTestVisible = async () => {
    if (!containerRef.current) return;

    const config = testConfigs[selectedConfig];
    setIsRunning(true);
    setCurrentTest(config.name);

    // Auto-cleanup previous test
    cleanupTest(activeTest);
    containerRef.current.innerHTML = "";

    try {
      const { editors, result } = await executeTest(config, editorCount, containerRef.current);
      setActiveTest({ config, editors, result });
      console.log(`${config.name}: ${result.creationTime.toFixed(2)}ms for ${editorCount} editors`);
    } catch (error) {
      console.error(`Test failed for ${config.name}:`, error);
    }

    setCurrentTest("");
    setIsRunning(false);
  };

  const runAllTests = async () => {
    if (!containerRef.current) return;

    setIsRunning(true);
    setResults([]);
    setProgress(0);

    // Auto-cleanup active test
    cleanupTest(activeTest);
    setActiveTest(null);

    const newResults: TestResult[] = [];
    const totalTests = testConfigs.length;

    for (let i = 0; i < testConfigs.length; i++) {
      const config = testConfigs[i];
      setCurrentTest(config.name);
      containerRef.current.innerHTML = "";

      try {
        const { editors, result } = await executeTest(config, editorCount, containerRef.current);
        
        // Clean up immediately for benchmark mode
        editors.forEach((editor) => config.cleanup(editor));
        containerRef.current.innerHTML = "";
        
        newResults.push(result);
        setResults([...newResults]);
        
        console.log(`${config.name}: ${result.creationTime.toFixed(2)}ms for ${editorCount} editors`);
      } catch (error) {
        console.error(`Test failed for ${config.name}:`, error);
      }

      setProgress(((i + 1) / totalTests) * 100);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    setCurrentTest("");
    setIsRunning(false);
  };

  const clearResults = () => {
    setResults([]);
    setProgress(0);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanupTest(activeTest);
  }, [activeTest]);

  return (
    <Container>
      <div className="performance-header">
        <h2 className="performance-title">CodeMirror Performance Benchmark</h2>

        <div className="performance-controls">
          <div className="input-group">
            <label>Editors per Test:</label>
            <input
              type="number"
              value={editorCount}
              onChange={(e) => setEditorCount(Math.max(1, parseInt(e.target.value) || 1))}
              className="number-input"
              min="1"
              max="100"
              disabled={isRunning}
            />
          </div>

          <div className="input-group">
            <label>Test Configuration:</label>
            <select
              value={selectedConfig}
              onChange={(e) => setSelectedConfig(parseInt(e.target.value))}
              className="config-select"
              disabled={isRunning}
            >
              {testConfigs.map((config, i) => (
                <option key={i} value={i}>
                  {config.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="performance-actions">
          <Button onClick={runSingleTestVisible} variant="primary" disabled={isRunning}>
            {isRunning && currentTest ? "Creating..." : "Run & Show Selected Test"}
          </Button>
          <Button onClick={runAllTests} variant="primary" disabled={isRunning}>
            {isRunning ? "Running All Tests..." : "Benchmark All Tests"}
          </Button>
          <Button onClick={clearResults} variant="primary" disabled={isRunning}>
            Clear Results
          </Button>
        </div>

        {isRunning && (
          <div className="performance-progress">
            <div>Current Test: {currentTest}</div>
            {progress > 0 && (
              <>
                <div className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div>{progress.toFixed(1)}% Complete</div>
              </>
            )}
          </div>
        )}

        {activeTest && (
          <div className="active-test-info">
            <h3>Active Test: {activeTest.config.name}</h3>
            <div className="test-stats">
              <span>Editors: {activeTest.result.editorCount}</span>
              <span>Creation Time: {activeTest.result.creationTime.toFixed(2)}ms</span>
              <span>Avg/Editor: {activeTest.result.avgPerEditor.toFixed(2)}ms</span>
              {activeTest.result.memoryUsage && (
                <span>Memory: {(activeTest.result.memoryUsage / 1024 / 1024).toFixed(1)}MB</span>
              )}
            </div>
            <p className="test-description">{activeTest.config.description}</p>
          </div>
        )}

        {results.length > 0 && (
          <div className="performance-results">
            <h3>Benchmark Results</h3>
            <div className="results-table">
              <div className="results-header">
                <span>Configuration</span>
                <span>Total Time</span>
                <span>Avg/Editor</span>
                <span>Memory</span>
              </div>
              {results.map((result, i) => (
                <div key={i} className="results-row">
                  <span title={testConfigs.find(c => c.name === result.config)?.description}>
                    {result.config}
                  </span>
                  <span>{result.creationTime.toFixed(2)}ms</span>
                  <span>{result.avgPerEditor.toFixed(2)}ms</span>
                  <span>
                    {result.memoryUsage 
                      ? `${(result.memoryUsage / 1024 / 1024).toFixed(1)}MB`
                      : 'N/A'
                    }
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div ref={containerRef} className="editors-container" />

      <style jsx>{`
        .performance-header {
          padding: 20px;
          border-bottom: 1px solid #e0e0e0;
        }
        
        .performance-title {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 20px;
        }
        
        .performance-controls {
          display: flex;
          gap: 20px;
          margin-bottom: 20px;
          align-items: center;
          flex-wrap: wrap;
        }
        
        .input-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .input-group label {
          font-weight: 500;
          white-space: nowrap;
        }
        
        .number-input {
          padding: 4px 8px;
          border: 1px solid #ccc;
          border-radius: 4px;
          width: 80px;
        }
        
        .config-select {
          padding: 4px 8px;
          border: 1px solid #ccc;
          border-radius: 4px;
          min-width: 200px;
        }
        
        .performance-actions {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        
        .performance-progress {
          background: #f5f5f5;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        
        .progress-bar {
          width: 100%;
          height: 20px;
          background: #e0e0e0;
          border-radius: 10px;
          overflow: hidden;
          margin: 10px 0;
        }
        
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #4CAF50, #45a049);
          transition: width 0.3s ease;
        }
        
        .active-test-info {
          background: #e8f5e8;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 20px;
          border-left: 4px solid #4CAF50;
        }
        
        .active-test-info h3 {
          margin: 0 0 10px 0;
          color: #2e7d32;
        }
        
        .test-stats {
          display: flex;
          gap: 20px;
          margin-bottom: 10px;
          flex-wrap: wrap;
        }
        
        .test-stats span {
          background: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
        }
        
        .test-description {
          margin: 0;
          font-style: italic;
          color: #555;
        }
        
        .performance-results {
          margin-top: 20px;
        }
        
        .results-table {
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          overflow: hidden;
        }
        
        .results-header,
        .results-row {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          gap: 10px;
          padding: 12px;
          align-items: center;
        }
        
        .results-header {
          background: #f5f5f5;
          font-weight: bold;
          border-bottom: 1px solid #e0e0e0;
        }
        
        .results-row {
          border-bottom: 1px solid #f0f0f0;
        }
        
        .results-row:last-child {
          border-bottom: none;
        }
        
        .results-row:hover {
          background: #f9f9f9;
        }
        
        .editors-container {
          padding: 20px;
          max-height: 600px;
          overflow-y: auto;
        }
        
        .editor-item {
          margin-bottom: 8px;
        }
      `}</style>
    </Container>
  );
};

export default PerformanceTest;
