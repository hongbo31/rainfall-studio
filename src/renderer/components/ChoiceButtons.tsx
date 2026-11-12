import React from "react";

export default function ChoiceButtons({
  label,
  choices,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  choices: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="choice-buttons" role="group" aria-label={label}>
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          className="choice-button"
          aria-pressed={value === choice.value}
          disabled={disabled}
          onClick={() => onChange(choice.value)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
