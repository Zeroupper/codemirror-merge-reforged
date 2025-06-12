import React from "react";
import { forwardRef } from "react";

interface EditorContainerProps {
  className?: string;
}

const EditorContainer = forwardRef<HTMLDivElement, EditorContainerProps>(
  ({ className = "" }, ref) => {
    return <div ref={ref} className={`editor-container ${className}`} />;
  }
);

EditorContainer.displayName = "EditorContainer";

export default EditorContainer;
