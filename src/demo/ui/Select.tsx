import React from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: string;
}

const Select: React.FC<SelectProps> = ({ value, onChange, options, label }) => {
  return (
    <div className="flex justify-center items-center gap-4">
      {label && <label className="font-medium">{label}</label>}
      <select 
        value={value} 
        onChange={(e) => onChange(e.target.value)}
        className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {options.map(({ value: optValue, label: optLabel }) => (
          <option key={optValue} value={optValue}>{optLabel}</option>
        ))}
      </select>
    </div>
  );
};

export default Select;