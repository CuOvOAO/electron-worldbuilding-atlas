interface EditableFieldProps {
  label?: string;
  value: string;
  editing: boolean;
  onChange: (value: string) => void;
  multiline?: boolean;
  className?: string;
}

export function EditableField({ label, value, editing, onChange, multiline = false, className = '' }: EditableFieldProps): JSX.Element {
  return (
    <label className={`block ${className}`}>
      {label && <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-copper">{label}</span>}
      {editing ? (
        multiline ? (
          <textarea className="editable-textarea" value={value} onChange={(event) => onChange(event.target.value)} />
        ) : (
          <input className="editable-input" value={value} onChange={(event) => onChange(event.target.value)} />
        )
      ) : (
        <p className={multiline ? 'whitespace-pre-line leading-7 text-sepia' : 'leading-7 text-sepia'}>{value}</p>
      )}
    </label>
  );
}
