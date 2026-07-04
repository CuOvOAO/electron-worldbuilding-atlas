import { EditableField } from './EditableField';

interface EditableMarkdownBlockProps {
  label?: string;
  value: string;
  editing: boolean;
  onChange: (value: string) => void;
}

export function EditableMarkdownBlock({ label, value, editing, onChange }: EditableMarkdownBlockProps): JSX.Element {
  return (
    <div className="rounded-md border border-umber/25 bg-vellum/70 p-4">
      <EditableField label={label} value={value} editing={editing} onChange={onChange} multiline />
    </div>
  );
}
