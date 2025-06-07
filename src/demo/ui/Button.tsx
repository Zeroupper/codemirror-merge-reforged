import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'success';
  className?: string;
}

const Button: React.FC<ButtonProps> = ({ 
  children, 
  onClick, 
  variant = 'primary',
  className = '' 
}) => {
  const variantClass = variant === 'success' ? 'button-success' : 'button-primary';
  
  return (
    <button 
      className={`button ${variantClass} ${className}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
};

export default Button;