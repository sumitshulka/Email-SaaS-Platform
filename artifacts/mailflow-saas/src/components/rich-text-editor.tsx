import { useEffect, useRef, type ClipboardEvent, type FormEvent, type MouseEvent } from "react";
import { Bold, Italic, List, ListOrdered, Quote, Underline } from "lucide-react";
import { CONTACT_PLACEHOLDERS, escapeHtml } from "./campaign-placeholders";

type RichTextEditorProps = {
  value: string;
  onChange: (html: string, plainText: string) => void;
  placeholders?: Array<{ token: string; label: string }>;
  placeholderTitle?: string;
  placeholderDescription?: string;
  testId?: string;
};

type EditorCommand =
  | "bold"
  | "italic"
  | "underline"
  | "insertUnorderedList"
  | "insertOrderedList"
  | "fontName"
  | "fontSize"
  | "formatBlock";

const toolbarButton =
  "grid h-8 w-8 place-items-center rounded border border-transparent text-[#536172] hover:border-[#d8dde4] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9abbe1]";

export function RichTextEditor({
  value,
  onChange,
  placeholders = CONTACT_PLACEHOLDERS,
  placeholderTitle = "Personalization placeholders",
  placeholderDescription = "Click a field to insert it. Its value is filled in separately for each recipient when the campaign is sent.",
  testId = "input-campaign-html-body",
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value) editor.innerHTML = value;
  }, [value]);

  const publishChange = () => {
    const editor = editorRef.current;
    if (editor) onChange(editor.innerHTML, editor.innerText);
  };

  const runCommand = (command: EditorCommand, argument?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, argument);
    publishChange();
  };

  const insertText = (text: string) => {
    editorRef.current?.focus();
    document.execCommand("insertText", false, text);
    publishChange();
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const plainText = event.clipboardData.getData("text/plain");
    const safeHtml = plainText
      .split(/\r?\n/)
      .map(escapeHtml)
      .join("<br>");
    document.execCommand("insertHTML", false, safeHtml);
    publishChange();
  };

  const handleInput = (_event: FormEvent<HTMLDivElement>) => publishChange();

  const keepEditorSelection = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <div className="overflow-hidden rounded-md border border-[#d8dde4] bg-white focus-within:border-[#3b73b8] focus-within:ring-2 focus-within:ring-[#dbe8f7]">
      <div className="flex flex-wrap items-center gap-1 border-b border-[#e7ebef] bg-[#f7f9fb] px-2 py-1.5" role="toolbar" aria-label="Text formatting">
        <button type="button" className={toolbarButton} aria-label="Bold" title="Bold" data-testid="button-editor-bold" onMouseDown={keepEditorSelection} onClick={() => runCommand("bold")}><Bold className="h-4 w-4"/></button>
        <button type="button" className={toolbarButton} aria-label="Italic" title="Italic" data-testid="button-editor-italic" onMouseDown={keepEditorSelection} onClick={() => runCommand("italic")}><Italic className="h-4 w-4"/></button>
        <button type="button" className={toolbarButton} aria-label="Underline" title="Underline" data-testid="button-editor-underline" onMouseDown={keepEditorSelection} onClick={() => runCommand("underline")}><Underline className="h-4 w-4"/></button>
        <span className="mx-1 h-5 border-l border-[#dfe4ea]"/>
        <label className="sr-only" htmlFor="rich-text-font-family">Font family</label>
        <select
          id="rich-text-font-family"
          aria-label="Font family"
          data-testid="select-editor-font-family"
          defaultValue="Arial"
          onMouseDown={() => editorRef.current?.focus()}
          onChange={event => runCommand("fontName", event.currentTarget.value)}
          className="h-8 rounded border border-[#d8dde4] bg-white px-2 text-[11px] text-[#536172] focus:outline-none focus:ring-2 focus:ring-[#9abbe1]"
        >
          <option value="Arial">Arial</option>
          <option value="Georgia">Georgia</option>
          <option value="Tahoma">Tahoma</option>
          <option value="Verdana">Verdana</option>
          <option value="Trebuchet MS">Trebuchet MS</option>
        </select>
        <label className="sr-only" htmlFor="rich-text-font-size">Text size</label>
        <select
          id="rich-text-font-size"
          aria-label="Text size"
          data-testid="select-editor-font-size"
          defaultValue="3"
          onMouseDown={() => editorRef.current?.focus()}
          onChange={event => runCommand("fontSize", event.currentTarget.value)}
          className="h-8 rounded border border-[#d8dde4] bg-white px-2 text-[11px] text-[#536172] focus:outline-none focus:ring-2 focus:ring-[#9abbe1]"
        >
          <option value="1">Tiny</option>
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="4">Large</option>
          <option value="5">Extra large</option>
          <option value="6">Huge</option>
        </select>
        <span className="mx-1 h-5 border-l border-[#dfe4ea]"/>
        <button type="button" className={toolbarButton} aria-label="Bulleted list" title="Bulleted list" data-testid="button-editor-bullets" onMouseDown={keepEditorSelection} onClick={() => runCommand("insertUnorderedList")}><List className="h-4 w-4"/></button>
        <button type="button" className={toolbarButton} aria-label="Numbered list" title="Numbered list" data-testid="button-editor-numbered-list" onMouseDown={keepEditorSelection} onClick={() => runCommand("insertOrderedList")}><ListOrdered className="h-4 w-4"/></button>
        <button type="button" className={toolbarButton} aria-label="Block quote" title="Block quote" data-testid="button-editor-quote" onMouseDown={keepEditorSelection} onClick={() => runCommand("formatBlock", "blockquote")}><Quote className="h-4 w-4"/></button>
      </div>
      <div
        ref={editorRef}
        role="textbox"
        aria-label="Formatted email message"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        data-testid={testId}
        onInput={handleInput}
        onPaste={handlePaste}
        className="min-h-[220px] max-h-[55vh] overflow-y-auto px-3 py-3 text-[13px] leading-6 text-[#182333] outline-none empty:before:text-[#a0a8b3] empty:before:content-['Write_your_message…'] [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-[#9abbe1] [&_blockquote]:pl-3 [&_h1]:my-2 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:my-2 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:my-2 [&_h3]:text-base [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:my-2 [&_ol]:list-decimal [&_p]:my-1 [&_ul]:my-2 [&_ul]:list-disc"
      />
      <div className="border-t border-[#edf0f2] bg-[#fbfcfd] px-3 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#788596]">{placeholderTitle}</div>
        <p className="mt-1 text-[10px] leading-4 text-[#8993a0]">{placeholderDescription}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {placeholders.map(({ token, label }) => (
            <button
              key={token}
              type="button"
              onMouseDown={keepEditorSelection}
              onClick={() => insertText(token)}
              className="rounded border border-[#dce4ec] bg-white px-2 py-1 text-[10px] font-medium text-[#365a7e] hover:border-[#9abbe1] hover:bg-[#f1f7fd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9abbe1]"
              data-testid={`button-insert-placeholder-${token.slice(2, -2)}`}
              title={`Insert ${token}`}
            >
              {label} <span className="mono ml-1 text-[#73869a]">{token}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}