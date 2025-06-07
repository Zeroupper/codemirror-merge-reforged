import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MergeViewDemo from './demo/MergeViewDemo';

const App: React.FC = () => {
  return (
    <Router>
      <div className="min-h-screen bg-gray-100 py-8">
        <Routes>
          <Route path="/" element={<MergeViewDemo />} />
          <Route path="/merge-demo" element={<MergeViewDemo />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
};

export default App;