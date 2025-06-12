import React from "react";
import Button from "./Button";

type ViewType = "split" | "unified";

interface ViewTypeToggleProps {
  viewType: ViewType;
  onViewTypeChange: (type: ViewType) => void;
}

const ViewTypeToggle: React.FC<ViewTypeToggleProps> = ({
  viewType,
  onViewTypeChange,
}) => {
  return (
    <div className="view-toggle">
      <Button
        variant={viewType === "split" ? "success" : "primary"}
        onClick={() => onViewTypeChange("split")}
      >
        Split Merge View
      </Button>
      <Button
        variant={viewType === "unified" ? "success" : "primary"}
        onClick={() => onViewTypeChange("unified")}
      >
        Unified Merge View
      </Button>
    </div>
  );
};

export default ViewTypeToggle;