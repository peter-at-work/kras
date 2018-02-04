import { asScript, watch } from '../helpers/io';
import { basename } from 'path';
import { fromJson } from '../helpers/build-response';
import { KrasRequest, KrasConfiguration, Headers, StoredFileEntry, KrasInjectorConfig, KrasInjector, KrasAnswer, KrasInjectorOptions } from '../types';

function errorHandler(): undefined {
  return undefined;
}

export interface ScriptContextData {
  [prop: string]: any;
}

export interface ScriptInjectorConfig {
  directory?: string;
  extended?: ScriptContextData;
}

export interface DynamicScriptInjectorConfig {
  [file: string]: boolean;
}

interface ScriptResponseBuilderData {
  statusCode: number;
  statusText: string;
  headers: Headers;
  content: string;
}

interface ScriptResponseBuilder {
  (data: ScriptResponseBuilderData): KrasAnswer;
}

interface ScriptFileEntry {
  active: boolean;
  file?: string;
  error?: string;
  handler?(ctx: ScriptContextData, req: KrasRequest, builder: ScriptResponseBuilder): KrasAnswer | Promise<KrasAnswer> | undefined;
}

interface ScriptFiles {
  [file: string]: ScriptFileEntry;
}

export default class ScriptInjector implements KrasInjector {
  private readonly db: ScriptFiles = {};
  private readonly options: KrasInjectorConfig & ScriptInjectorConfig;

  constructor(options: KrasInjectorConfig & ScriptInjectorConfig, config: KrasConfiguration) {
    const directory = options.directory || config.directory;
    this.options = options;

    watch(directory, '**/*.js', (ev, file) => {
      switch (ev) {
        case 'create':
        case 'update':
          return this.load(file);
        case 'delete':
          delete this.db[file];
          return;
      }
    });
  }

  getOptions(): KrasInjectorOptions {
    const entries = this.getAllEntries();
    const options: KrasInjectorOptions = {};

    for (const entry of entries) {
      options[entry.file] = {
        description: `Status of ${entry.file}. ${entry.error ? 'Error: ' + entry.error : ''}`,
        title: basename(entry.file),
        type: 'checkbox',
        value: entry.active,
      };
    }

    return options;
  }

  setOptions(options: DynamicScriptInjectorConfig): void {
    const entries = Object.keys(options).map(option => ({
      file: option,
      active: options[option],
    }));

    this.setAllEntries(entries);
  }

  get name() {
    return 'script-injector';
  }

  get active() {
    return this.options.active;
  }

  set active(value: boolean) {
    this.options.active = value;
  }

  private load(file: string) {
    const script = this.db[file] || {
      active: true,
    };

    try {
      const handler = asScript(file);
      script.error = undefined;
      script.handler = handler;
    } catch (e) {
      console.error(e);
      script.error = e;
      script.handler = errorHandler;
    }

    this.db[file] = script;
  }

  private setAllEntries(entries: Array<{ file: string, active: boolean }>) {
    for (const entry of entries) {
      const script = this.db[entry.file];

      if (script) {
        script.active = entry.active;
      }
    }
  }

  private getAllEntries() {
    const fileNames = Object.keys(this.db);
    const entries: Array<StoredFileEntry> = [];

    for (const fileName of fileNames) {
      const item = this.db[fileName];
      entries.push({
        active: item.active,
        file: fileName,
        error: item.error,
      });
    }

    return entries;
  }

  handle(req: KrasRequest) {
    for (const file of Object.keys(this.db)) {
      const script = this.db[file];
      const name = this.name;

      if (script.active) {
        const handler = script.handler;
        const builder = ({ statusCode = 200, statusText = '', headers = {}, content = '' }) => fromJson(req.url, statusCode, statusText, headers, content, {
          name,
          file: {
            name: file,
          },
        });
        const extended = this.options.extended || {};
        const ctx = { ...extended };
        const res = handler(ctx, req, builder);

        if (res) {
          return res;
        }
      }
    }
  }
}
