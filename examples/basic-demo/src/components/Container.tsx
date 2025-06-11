import React from 'react';

interface ContainerProps {
  children: React.ReactNode;
  className?: string;
}

const Container: React.FC<ContainerProps> = ({ children, className = '' }) => {
  return (
    <div className={`max-w-7xl mx-auto bg-white p-6 rounded-lg shadow-lg ${className}`}>
      {children}
    </div>
  );
};

export default Container;