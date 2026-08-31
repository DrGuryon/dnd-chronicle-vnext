import { errorMessage, escapeHtml } from '../html';

export interface DialogOption {
  value: string;
  label: string;
}

export interface DialogField {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'password' | 'textarea' | 'select';
  value?: string | number | null;
  placeholder?: string;
  required?: boolean;
  maxlength?: number;
  min?: number;
  max?: number;
  options?: readonly DialogOption[];
  section?: string;
  autocomplete?: string;
}

export interface FormDialogRequest<T> {
  title: string;
  description?: string;
  submitLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  fields?: readonly DialogField[];
  validate?(values: Readonly<Record<string, string>>): Readonly<Partial<Record<string, string>>>;
  submit(values: Readonly<Record<string, string>>): Promise<T>;
}

export class FormDialog {
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly dialog: HTMLDialogElement) {}

  open<T>(request: FormDialogRequest<T>): Promise<T | null> {
    if (this.dialog.open) this.dialog.close();
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.dialog.innerHTML = shell(request);
    this.dialog.showModal();

    return new Promise<T | null>((resolve) => {
      let settled = false;
      const finish = (value: T | null): void => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const close = (): void => {
        finish(null);
        this.dialog.close();
      };
      this.dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        close();
      }, { once: true });
      this.dialog.addEventListener('close', () => {
        finish(null);
        this.returnFocus?.focus();
        this.returnFocus = null;
      }, { once: true });
      this.dialog.querySelectorAll('[data-dialog-cancel]').forEach((button) => {
        button.addEventListener('click', close, { once: true });
      });
      const form = this.dialog.querySelector<HTMLFormElement>('form')!;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
        const errors = request.validate?.(values) ?? {};
        renderErrors(form, errors);
        if (Object.keys(errors).length) {
          form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
          return;
        }
        const fieldset = form.querySelector<HTMLFieldSetElement>('fieldset')!;
        const submit = form.querySelector<HTMLButtonElement>('[data-dialog-submit]')!;
        const original = submit.textContent;
        fieldset.disabled = true;
        submit.textContent = 'Pracuji…';
        try {
          const result = await request.submit(values);
          finish(result);
          this.dialog.close();
        } catch (error) {
          const message = form.querySelector<HTMLElement>('[data-dialog-error]')!;
          message.textContent = errorMessage(error);
          message.hidden = false;
          fieldset.disabled = false;
          submit.textContent = original;
        }
      });
      requestAnimationFrame(() => {
        this.dialog.querySelector<HTMLElement>('input, select, textarea, [data-dialog-submit]')?.focus();
      });
    });
  }

  confirm(title: string, description: string, submitLabel: string): Promise<boolean> {
    return this.open({
      title,
      description,
      submitLabel,
      danger: true,
      submit: async () => true,
    }).then(Boolean);
  }
}

function shell<T>(request: FormDialogRequest<T>): string {
  let section = '';
  const fields = (request.fields ?? []).map((field) => {
    const heading = field.section && field.section !== section
      ? `<h3>${escapeHtml(field.section)}</h3>`
      : '';
    if (field.section) section = field.section;
    return `${heading}${renderField(field)}<p class="field-error" data-error-for="${escapeHtml(field.name)}"></p>`;
  }).join('');
  return `<form class="form-dialog-shell">
    <header><div><p>CHRONICLE</p><h2>${escapeHtml(request.title)}</h2></div>
      <button type="button" data-dialog-cancel aria-label="Zavřít">×</button></header>
    <fieldset>
      <div class="form-dialog-scroll">
        ${request.description ? `<p class="dialog-description">${escapeHtml(request.description)}</p>` : ''}
        ${fields}
        <p class="dialog-error" data-dialog-error role="alert" hidden></p>
      </div>
      <footer><button type="button" data-dialog-cancel>${escapeHtml(request.cancelLabel ?? 'Zrušit')}</button>
        <button type="submit" data-dialog-submit class="${request.danger ? 'danger-button' : 'primary-button'}">${escapeHtml(request.submitLabel)}</button></footer>
    </fieldset>
  </form>`;
}

function renderField(field: DialogField): string {
  const type = field.type ?? 'text';
  const attributes = [
    `name="${escapeHtml(field.name)}"`,
    field.required ? 'required' : '',
    field.maxlength ? `maxlength="${field.maxlength}"` : '',
    field.min !== undefined ? `min="${field.min}"` : '',
    field.max !== undefined ? `max="${field.max}"` : '',
    field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '',
    field.autocomplete ? `autocomplete="${escapeHtml(field.autocomplete)}"` : '',
  ].filter(Boolean).join(' ');
  const value = field.value ?? '';
  const control = type === 'select'
    ? `<select ${attributes}>${(field.options ?? []).map((option) => `<option value="${escapeHtml(option.value)}"${String(value) === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`
    : type === 'textarea'
      ? `<textarea ${attributes}>${escapeHtml(value)}</textarea>`
      : `<input type="${type}" value="${escapeHtml(value)}" ${attributes}>`;
  return `<label class="form-field"><span>${escapeHtml(field.label)}${field.required ? ' *' : ''}</span>${control}</label>`;
}

function renderErrors(form: HTMLFormElement, errors: Readonly<Partial<Record<string, string>>>): void {
  form.querySelectorAll<HTMLElement>('[data-error-for]').forEach((element) => {
    const name = element.dataset.errorFor ?? '';
    element.textContent = errors[name] ?? '';
    const control = form.elements.namedItem(name);
    if (control instanceof HTMLElement) control.setAttribute('aria-invalid', errors[name] ? 'true' : 'false');
  });
}
