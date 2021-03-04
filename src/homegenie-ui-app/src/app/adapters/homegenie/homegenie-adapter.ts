import {Subject} from 'rxjs';
import {map, tap} from 'rxjs/operators';

import {Adapter} from '../adapter';
import {CMD, FLD, HguiService} from 'src/app/services/hgui/hgui.service';
import {
  Module as HguiModule,
  ModuleField,
  ModuleType
} from 'src/app/services/hgui/module';
import {
  ModuleOptions,
  OptionField,
  OptionFieldTypeId
} from 'src/app/services/hgui/module-options';
import {Group, HomegenieApi, Module, ModuleParameter, Program} from './homegenie-api';
import {HomegenieZwaveAdapter} from './homegenie-zwave-adapter';
import {ZwaveAdapter} from '../zwave-adapter';
import {Scenario, Schedule} from "../../services/hgui/automation";
import {SensorData} from "../../widgets/sensor/sensor.component";
import {WeatherForecastData} from "../../widgets/weather-forecast/weather-forecast.component";
import {WidgetOptions} from "../../widgets/widget-options";
import {EnergyMonitorData} from "../../widgets/energy-monitor/energy-monitor.component";

export {Module, Group, Program};

export class ApiResponse {
  code: number;
  response: any;
}
export enum ResponseCode {
  Success = 200
}

export class HomegenieAdapter implements Adapter {
  className = 'HomegenieAdapter';
  translationPrefix = 'HOMEGENIE';
  onModuleEvent = new Subject<{ module: HguiModule, event: any }>();
  private EnableWebsocketStream = true;
  private ImplementedWidgets = [
    'Dimmer',
    'Switch',
    'Light',
    'Siren',
    'Program',
    'Sensor',
    'DoorWindow',
    "Thermostat"
  ];
  private eventSource;
  private webSocket;
  private _programs: Array<Program> = [];

  private _zwaveAdapter = new HomegenieZwaveAdapter(this);
  get zwaveAdapter(): ZwaveAdapter {
    return this._zwaveAdapter;
  }

  constructor(private _hgui: HguiService) {
  }

  get hgui(): HguiService {
    return this._hgui;
  }

  get id(): string {
    let address = '0.0.0.0';
    const cfg = this.options.config;
    if (cfg != null && cfg.connection != null) {
      address = cfg.connection.localRoot ? 'local' : cfg.connection.address + ':' + cfg.connection.port;
    }
    return address;
  }

  private _options = {};

  get options(): any {
    return this._options;
  }

  set options(opts: any) {
    this._options = opts;
  }

  private _groups: Array<Group> = [];

  get groups(): any {
    return this._groups;
  }

  private _modules: Array<Module> = [];

  get modules(): any {
    return this._modules;
  }

  connect(): Subject<any> {
    const subject = new Subject<any>();
    this.apiCall(HomegenieApi.Config.Modules.List)
      .subscribe((res) => {
          const status = res.code;
          const mods: Array<Module> = res.response;
          if (+status === ResponseCode.Success) {
            this._modules.length = 0;
            // filter out unsupported modules
            mods.map((m) => {
              if (this.ImplementedWidgets.includes(m.DeviceType)) {
                const domainShort = m.Domain.substring(
                  m.Domain.lastIndexOf('.') + 1
                );
                if (m.Name === '') {
                  m.Name = domainShort + ' ' + m.Address;
                }
                this._modules.push(m);


                // TODO: optimize this
                // update fields of associated HGUI module if exists
                m.Properties.map((p) => {
                  const moduleId = m.Domain + '/' + m.Address;
                  let module = this._hgui.getModule(moduleId, this.id);
                  if (module == null) {
                    // add new module to HGUI modules if missing
                    module = this.hgui.addModule(new HguiModule({
                      id: moduleId,
                      adapterId: this.id,
                      type: m.DeviceType.toLowerCase(),
                      name: m.Name,
                      description: m.Description,
                      fields: [],
                    }));
                  }
                  module.field(p.Name, p.Value, p.UpdateTime);
                });
                // TODO: optimize this ^^^^


              } else {
                console.log('@@@', 'Unsupported module type!', m);
              }
            });
            this.apiCall(HomegenieApi.Config.Groups.List)
              .subscribe((listRes) => {
                  const groups: Array<Group> = listRes.response;
                  this._groups = groups;
                  // finally connect to the real-time event stream
                  if (this.EnableWebsocketStream) {
                    this.connectWebSocket();
                  } else {
                    this.connectEventSource();
                  }
                  subject.next();
                }
              );
          } else {
            subject.next(status);
          }
        }
      );
    return subject;
  }

  system(command: string, options?: any): Subject<Scenario> {
    const subject = new Subject<any>();
    switch (command) {
      case CMD.Automation.Scenarios.List:
        this.apiCall(HomegenieApi.Automation.Programs.List)
          .subscribe((res) => {
            this._programs = res.response;
            subject.next(this._programs.filter((p) => {
              if (!p.IsEnabled) return;
              const programModule = this.getModule(`${p.Domain}/${p.Address}`);
              if (!programModule) return;
              const programWidget = this.getModuleWidget(programModule);
              if (programWidget && programWidget.Value === 'homegenie/generic/program') {
                return p;
              }
            }).map((p) => ({
              id: `${p.Address}`,
              name: p.Name,
              description: p.Description
            }) as Scenario));
            subject.complete();
          });
        break;
      case CMD.Automation.Scheduling.List:
        this.apiCall(HomegenieApi.Automation.Scheduling.List)
          .subscribe((res) => {
            const list: Schedule[] = [];
            res.response.forEach((s) => {
              const boundDeviceTypes = s.BoundDevices.map((d) => d.toLowerCase());
              const boundModules = s.BoundModules.map((m) => this.hgui.getModule(this.getModuleId(m), this.id));
              let matching = s.IsEnabled;
              // filter by device type if argument was supplied
              if (options && options.type) {
                matching = matching && boundDeviceTypes.indexOf(options.type) >= 0;
              }
              if (matching) {
                list.push({
                  id: s.Name,
                  name: s.Name,
                  description: s.Description,
                  boundModules: boundModules,
                  moduleTypes: boundDeviceTypes
                } as Schedule)
              }
            });
            subject.next(list);
            subject.complete();
          });
        break;
      case CMD.Automation.Scheduling.ListOccurrences:
        this.apiCall(HomegenieApi.Automation.Scheduling.ListOccurrences(options.hourSpan, options.startTimestamp))
          .subscribe((res) => {
            subject.next(res.response);
            subject.complete();
          });
        break;
    }
    return subject;
  }

  control(m: HguiModule, command: string, options?: any): Subject<any> {
    // adapter-specific implementation
    switch (command) {
      case CMD.Options.Get:
        if (m.type === ModuleType.Program) {
          return this.getProgramOptions(m);
        } else {
          return this.getModuleFeatures(m);
        }
      case CMD.Options.Set:
        return this.apiCall(HomegenieApi.Config.Modules.ParameterSet(m), options);
      case CMD.Statistics.Field.Get:
        return this.apiCall(HomegenieApi.Config.Modules.StatisticsGet(m.id, options));
    }

    if (options == null) {
      options = '';
    }
    if (m.type === ModuleType.Program) {
      // program API command
      const programAddress = m.id.substring(m.id.lastIndexOf('/') + 1);
      options = programAddress + '/' + options;
      return this.apiCall(HomegenieApi.Automation.Command(command, options));
    } else {
      // module API command
      return this.apiCall(`${m.id}/${command}/${options}`);
    }
  }

  getWidgetOptions(module: HguiModule): WidgetOptions {
    const m = this.getModule(module.id);
    if (!m) return;
    const widget = this.getModuleWidget(m);
    // Return widget options from module widget...
    if (widget) {
      switch (widget.Value) {
        case 'homegenie/generic/energymonitor':
          return {
            // TODO: create constant for this, eg: `HgUi.WidgetTypes.EnergyMonitor`
            widget: 'energy-monitor',
            icon: this.getModuleIcon(m),
            data: {
              wattLoad: module.field('EnergyMonitor.WattLoad'),
              operatingLights: module.field('EnergyMonitor.OperatingLights'),
              operatingAppliances: module.field('EnergyMonitor.OperatingSwitches'),
              todayCounter: module.field('EnergyMonitor.KwCounter.Today'),
              totalCounter: module.field('EnergyMonitor.KwCounter')
            } as EnergyMonitorData
          }
        case 'homegenie/environment/weather':
          // populate forecast data
          const forecastData = [1, 2, 3].map((i) => {
            const weekday = module.field(`Conditions.Forecast.${i}.Weekday`);
            const day = module.field(`Conditions.Forecast.${i}.Day`);
            const month = module.field(`Conditions.Forecast.${i}.Month`);
            return {
              date: `${weekday.value}, ${day.value} ${month.value}`,
              // TODO: !!!!!!!! implement icon mapping !!!!!!!!!!
              icon: module.field(`Conditions.Forecast.${i}.IconType`),
              description: module.field(`Conditions.Forecast.${i}.Description`),
              temperature: module.field(`Conditions.Forecast.${i}.Temperature`),
              minC: module.field(`Conditions.Forecast.${i}.Temperature.Min`),
              maxC: module.field(`Conditions.Forecast.${i}.Temperature.Max`)
            }
          });
          // build WeatherForecastData structure
          let data: WeatherForecastData = {
            location: {
              name: module.field('Conditions.City'),
              country: module.field('Conditions.Country')
            },
            astronomy: {
              sunrise: module.field('Astronomy.Sunrise'),
              sunset: module.field('Astronomy.Sunset')
            },
            today: {
              // TODO: FIX DATE
              date: new Date(),
              // TODO: !!!!!!!! implement icon mapping !!!!!!!!!!
              icon: module.field(`Conditions.IconType`),
              description: module.field('Conditions.Description'),
              temperatureC: module.field(FLD.Sensor.Temperature),
              pressureMb: module.field(FLD.Sensor.Pressure),
              wind: {
                speedKph: module.field(FLD.Sensor.Wind.Speed),
                direction: module.field(FLD.Sensor.Wind.Direction)
              },
              precipitation: {
                snowMm: module.field(FLD.Sensor.Precipitation.Snow),
                rainMm: module.field(FLD.Sensor.Precipitation.Rain)
              }
            },
            forecast: forecastData
          };
          return {
            // TODO: create constant for this, eg: `HgUi.WidgetTypes.WeatherForecast`
            widget: 'weather-forecast',
            icon: this.getModuleIcon(m),
            data
          }
        case 'homegenie/generic/securitysystem':
          return {
            // TODO: create constant for this, eg: `HgUi.WidgetTypes.Thermostat`
            widget: 'alarm-system',
            icon: this.getModuleIcon(m)
          }
      }
    }
    // ...or return widget options from module type
    if (module.type === ModuleType.Sensor || module.type === ModuleType.DoorWindow) {
      const sensorFields = module.fields.filter((f) => f.key.startsWith('Sensor.'));
      return {
        // TODO: create constant for this, eg: `HgUi.WidgetTypes.Sensor`
        widget: 'sensor',
        icon: this.getModuleIcon(m),
        data: {
          sensors: sensorFields.map((f) => ({
            field: f,
            unit: '' // TODO: implement locale unit support
          }))
        } as SensorData
      }
    } else if (
      module.type === ModuleType.Switch ||
      module.type === ModuleType.Dimmer ||
      module.type === ModuleType.Light ||
      module.type === ModuleType.Siren
    ) {
      const color = widget && widget.Value === 'homegenie/generic/colorlight';
      let dimming = color || (module.type !== ModuleType.Light && module.type !== ModuleType.Switch);
      return {
        /*
        the 'siwtch' widget is used for all switchable types,
        including dimmers and color lights
        // TODO: rename 'switch' to something else and
        // TODO: implement a static WidgetType class
        */
        // TODO: create constant for this, eg: `HgUi.WidgetTypes.Dimmer` and `HgUi.WidgetTypes.Switch`
        widget: 'switch',
        icon: this.getModuleIcon(m),
        features: {
          color: color,
          dimming: dimming
        }
      }
    } else if (module.type === ModuleType.Thermostat) {
      return {
        widget: 'thermostat',
        icon: this.getModuleIcon(m),
        features: {
          cooling: true,
          heating: true,
          auto: true,
          ecoMode: true,
          fanMode: true
        }
      }
    }
  }

  apiCall(apiMethod: string, postData?: any): Subject<ApiResponse> {
    const oc = this.options.config.connection;
    if (oc == null) {
      return;
    }
    const url = this.getBaseUrl() + `api/${apiMethod}`;
    // TODO: implement a global service logger
    // cp.log.info(url);
    if (postData) {
      return this._hgui.http
        .post<any>(url, postData, {
          // TODO: basic authentication
          headers: {
            'Content-Type' : 'application/json',
            'Cache-Control': 'no-cache'
          //    Authorization: 'Basic ' + btoa(oc.credentials.username + ':' + oc.credentials.password)
          }
        }).pipe(
          // tap(() => console.log('HTTP request executed')),
          map(res => ({code: ResponseCode.Success, response: res}))
        ) as Subject<ApiResponse>;
    }
    return this._hgui.http
      .get(url, {
        // TODO: basic authentication
        headers: {
        //    Authorization: 'Basic ' + btoa(oc.credentials.username + ':' + oc.credentials.password)
        }
      }).pipe(
        // tap(() => console.log('HTTP request executed')),
        map(res => ({code: ResponseCode.Success, response: res}))
      ) as Subject<ApiResponse>;
  }

  reloadModules(): Subject<Array<Module>> {
    const subject = new Subject<Array<Module>>();
    this.apiCall(HomegenieApi.Config.Modules.List)
      .subscribe((res) => {
          const status = res.code;
          const mods: Array<Module> = res.response;
          if (+status === ResponseCode.Success) {
            this._modules.length = 0;
            // filter out unsupported modules
            mods.map((m) => {
              if (this.ImplementedWidgets.includes(m.DeviceType)) {
                const domainShort = m.Domain.substring(
                  m.Domain.lastIndexOf('.') + 1
                );
                if (m.Name === '') {
                  m.Name = domainShort + ' ' + m.Address;
                }
                const moduleId = this.getModuleId(m);
                const existingModule = this.getModule(moduleId);
                if (!existingModule) {
                  this._modules.push(m);
                } else {
                  existingModule.Properties = m.Properties;
                }

                // TODO: optimize this
                // Export module to HGUI
                let hguiModule = this.hgui.getModule(moduleId, this.id);
                if (hguiModule == null) {
                  // add new module to HGUI modules if missing
                  hguiModule = this.hgui.addModule(new HguiModule({
                    id: moduleId,
                    adapterId: this.id,
                    type: m.DeviceType.toLowerCase(),
                    name: m.Name,
                    description: m.Description,
                    fields: [],
                  }));
                }

                // Update modules fields (hgui fields = hg Properties)
                m.Properties.map((p) => {
                  hguiModule.field(p.Name, p.Value, p.UpdateTime);
                });

              }
            });
            subject.next(this._modules);
          } else {
            subject.error(status);
          }
        }
      );
    return subject;
  }

  getModuleId(module: Module): string {
    return `${module.Domain}/${module.Address}`;
  }

  getModule(id: string): Module {
    const matchingModules = this._modules.filter(
      (i) => this.getModuleId(i) === id
    );
    if (matchingModules.length > 0) {
      return matchingModules[matchingModules.length - 1];
    }
  }

  private connectWebSocket(): void {
    if (this.webSocket != null) {
      this.webSocket.onclose = null;
      this.webSocket.onerror = null;
      this.webSocket.close();
    }
    const o = this.options.config.connection;
    this.apiCall(HomegenieApi.Config.WebSocket.GetToken)
      .subscribe((res) => {
          let port = 8188; // default port
          const oc = this.options.config.connection;
          if (oc != null && oc.websocketPort) {
            port = oc.websocketPort;
          }
          const r = res.response;
          this.webSocket = new WebSocket(
            `ws://${o.address}:${port}/events?at=${r.ResponseValue}`
          );
          this.webSocket.onopen = (e) => {
            // TODO: not implemented
          };
          this.webSocket.onclose = (e) => {
            setTimeout(this.connectWebSocket.bind(null), 1000);
          };
          this.webSocket.onmessage = (e) => {
            const event = JSON.parse(e.data);
            this.processEvent(event);
          };
          this.webSocket.onerror = (e) => {
            setTimeout(this.connectWebSocket.bind(null), 1000);
          };
        });
  }

  private connectEventSource(): void {
    let es = this.eventSource;
    if (es == null) {
      es = this.eventSource = new EventSource(this.getBaseUrl() + 'events');
    } else {
      try {
        es.close();
        es = this.eventSource = null;
      } catch (e) {
      }
      setTimeout(this.connectEventSource.bind(null), 1000);
      // TODO: implement a global service logger
      // cp.log.info('Reconnecting to HomeGenie SSE on ' + getBaseUrl());
    }
    es.onopen = (e) => {
      // TODO: implement a global service logger
      // cp.log.info('SSE connect');
    };
    es.onerror = (e) => {
      // TODO: implement a global service logger
      // cp.log.error('SSE error');
      es.close();
      es = this.eventSource = null;
      setTimeout(this.connectEventSource.bind(null), 1000);
    };
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      // TODO: implement a global service logger
      // cp.log.info('SSE data', event);
      this.processEvent(event);
    };
  }

  private getBaseUrl(): string {
    const oc = this.options.config.connection;
    if (oc == null) {
      // TODO: report 'connector not configured' error and exit
      return;
    }
    return oc.localRoot ? oc.localRoot : `http://${oc.address}:${oc.port}/`;
  }

  private processEvent(event /*: MigEvent*/): void {
    const moduleId = event.Domain + '/' + event.Source;
    const m: HguiModule = this._hgui.getModule(moduleId, this.id);
    this.onModuleEvent.next({module: m, event});
    if (m != null) {
      m.field(event.Property, event.Value, event.UnixTimestamp);
    }
    // update local hg-module
    const module = this._modules.find((mod) => mod.Domain === event.Domain && mod.Address === event.Source);
    if (module) {
      let property: ModuleParameter = module.Properties.find((p) => p.Name === event.Property);
      if (property == null) {
        property = {
          Name: event.Property,
          Value: event.Value,
          UpdateTime: event.UnixTimestamp
        };
        module.Properties.push(property);
      } else {
        property.Value = event.Value;
        property.UpdateTime = event.UnixTimestamp;
      }
    }
  }

  private getProgramOptions(m: HguiModule): Subject<ModuleOptions> {
    const subject = new Subject<ModuleOptions>();
    const programModule = this.getModule(m.id);
    if (!programModule) {
      console.log('WARNING', 'No module associated with this program.');
      setTimeout(() => {
        subject.next();
        subject.complete();
      }, 10);
    } else {
      const configOptions = programModule.Properties.filter((p: ModuleParameter) => p.Name.startsWith('ConfigureOptions.'));
      const options: OptionField[] = configOptions.map((o) => {
        const fieldType = o.FieldType.split(':');
        if (!m.field(o.Name)) {
          console.log('WARNING', m, o.Name);
        }
        return {
          pid: programModule.Address,
          name: o.Name,
          field: m.field(o.Name),
          description: o.Description,
          type: {
            id: this.getHgUiFieldType(fieldType),
            options: this.getHgUiFieldOptions(fieldType)
          },
        } as OptionField;
      }).sort((a, b) => a.description > b.description ? 1 : -1);
      setTimeout(() => {
        subject.next({
          id: programModule.Address,
          name: programModule.Name,
          description: programModule.Description,
          items: options
        });
        subject.complete();
      });
    }
    return subject;
  }

  private getModuleFeatures(m: HguiModule): Subject<ModuleOptions[]> {
    const subject = new Subject<ModuleOptions[]>();
    const module = this.getModule(m.id);
    this.apiCall(HomegenieApi.Automation.Programs.List)
      .subscribe((res) => {
          const programFeatures: ModuleOptions[] = [];
          this._programs = res.response;
          this._programs.map((p) => {
            if (p.IsEnabled && p.Features != null) {
              const pf: ModuleOptions = {
                id: p.Address,
                name: p.Name,
                description: p.Description,
                items: [] as OptionField[]
              };
              for (let i = 0; i < p.Features.length; i++) {
                const f = p.Features[i];
                let matchFeature = this.MatchValues(f.ForDomains, module.Domain);
                let forTypes = f.ForTypes;
                let forProperties: any = false;
                const propertyFilterIndex = forTypes.indexOf(':');
                if (propertyFilterIndex >= 0) {
                  forProperties = forTypes.substring(propertyFilterIndex + 1).trim();
                  forTypes = forTypes.substring(0, propertyFilterIndex).trim();
                }
                matchFeature = matchFeature && this.MatchValues(forTypes, module.DeviceType);
                if (forProperties !== false) {
                  let matchProperty = false;
                  for (let idx = 0; idx < module.Properties.length; idx++) {
                    const mp = module.Properties[idx];
                    if (this.MatchValues(forProperties, mp.Name)) {
                      matchProperty = true;
                      break;
                    }
                  }
                  matchFeature = matchFeature && matchProperty;
                }
                if (matchFeature) {
                  const type = f.FieldType.split(':');
                  let mf: ModuleField = m.field(f.Property);
                  // add the field if does not exist
                  if (mf == null) {
                    mf = {
                      key: f.Property,
                      value: null,
                      timestamp: null
                    };
                    m.fields.push(mf);
                  }
                  pf.items.push({
                    pid: p.Address,
                    field: mf,
                    type: {
                      id: this.getHgUiFieldType(type),
                      options: this.getHgUiFieldOptions(type)
                    },
                    name: p.Name,
                    description: f.Description
                  });
                }
              }
              if (pf.items.length > 0) {
                //pf.items = pf.items.sort((a, b) => a.description > b.description ? 1 : -1);
                programFeatures.push(pf);
              }
            }
            subject.next(programFeatures);
            subject.complete();
          });
          subject.next();
          subject.complete();
        }
      );
    return subject;
  }

  private getModuleWidget(m: Module) {
    return m.Properties
      .find((prop) => prop.Name === 'Widget.DisplayModule');
  }

  private getModuleIcon(m: Module): string {
    return this.getBaseUrl() + 'hg/html/pages/control/widgets/homegenie/generic/images/unknown.png';
  }

  private MatchValues(valueList, matchValue): boolean {
    // regexp matching
    if (valueList.trim().startsWith('/')) {
      valueList = valueList.replace(/^\/+|\/+$/g, '');
      return matchValue.match(valueList);
    }
    // classic comma separated value list matching
    valueList = valueList.toLowerCase();
    matchValue = matchValue.toLowerCase();
    let inclusionList = [valueList];
    if (valueList.indexOf(',') > 0) {
      inclusionList = valueList.split(',');
    } else if (valueList.indexOf('|') > 0) {
      inclusionList = valueList.split('|');
    }
    // build exclusion list and remove empty entries
    const exclusionList = [];
    for (let idx = 0; idx < inclusionList.length; idx++){
      const val = inclusionList[idx];
      if (val.trim().indexOf('!') === 0) {
        inclusionList.splice(idx, 1);
        exclusionList.push(val.trim().substring(1));
      } else if (val.trim().length === 0) {
        inclusionList.splice(idx, 1);
      }
    }
    // check if matching
    let isMatching = (inclusionList.length === 0);
    for (let idx = 0; idx < inclusionList.length; idx++){
      const val = inclusionList[idx];
      if (val.trim() === matchValue.trim()) {
        isMatching = true;
        break;
      }
    }
    // check if not in exclusion list
    for (let idx = 0; idx < exclusionList.length; idx++){
      const val = exclusionList[idx];
      if (val.trim() === matchValue.trim()) {
        isMatching = false;
        break;
      }
    }
    return isMatching;
  }

  private getHgUiFieldType(typeOptions: any[]): OptionFieldTypeId {
    // map HG custom type to HGUI type
    const typeId = typeOptions[0];
    switch (typeId) {
      case 'text':
        return OptionFieldTypeId.Text;
      case 'password':
        return OptionFieldTypeId.Password;
      case 'checkbox':
        return OptionFieldTypeId.CheckBox;
      case 'slider':
        return OptionFieldTypeId.Slider;
      case 'wunderground.city':
        // add callback to populate autocomplete list (must return an Observable<string[]> with location names list)
        typeOptions[1] = value => {
          return this.apiCall('HomeAutomation.OpenWeatherMap/2.5/Search.Location/' + value)
            .pipe(
              // transform response to simple string array
              map(o => o.response.map((l) => {
                return l.description;
              }))
            );
        };
        return OptionFieldTypeId.Location;
      case 'module.text':
        return OptionFieldTypeId.ModuleSelect;
      case 'program.text':
        return OptionFieldTypeId.ScenarioSelect;
      case 'capture':
        return OptionFieldTypeId.FieldCapture;
    }
  }
  private getHgUiFieldOptions(typeOptions: string[]): any[] {
    return typeOptions.slice(1);
  }
}
