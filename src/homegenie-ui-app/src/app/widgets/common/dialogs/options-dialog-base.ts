import {Component, Inject} from '@angular/core';
import {Module, ModuleField} from "../../../services/hgui/module";
import {TranslateService} from "@ngx-translate/core";
import {MAT_DIALOG_DATA, MatDialogRef} from "@angular/material/dialog";
import {ModuleOptions} from "../../../services/hgui/module-options";

@Component({
  selector: '-options-dialog-base',
  template: 'no-ui'
})
export class OptionsDialogBase {

  changes: { field: ModuleField, value: any }[] = [];
  translationPrefix: string;

  constructor(
    protected translate: TranslateService,
    public dialogRef: MatDialogRef<any>,
    @Inject(MAT_DIALOG_DATA) public module: Module
  ) {
    if (module.getAdapter()) {
      this.translationPrefix = module.getAdapter().translationPrefix;
    } else {
      // TODO: log this exception
    }
  }

  onFieldChange(e): void {
    if (e.field.value === e.value) {
      this.changes = this.changes.filter((c) => c.field.key !== e.field.key);
    } else {
      let change = this.changes.find((c) => c.field.key === e.field.key);
      if (change) {
        change.value = e.value;
      } else {
        this.changes.push(e);
      }
    }
  }

  protected translateModuleOption(o: ModuleOptions) {
    const titleKey = `${this.translationPrefix}.$options.${o.id}.Title`;
    this.translate.get(titleKey).subscribe((tr) => {
      if (tr !== titleKey) {
        o.name = tr;
      }
    });
    const descriptionKey = `${this.translationPrefix}.$options.${o.id}.Description`;
    this.translate.get(descriptionKey).subscribe((tr) => {
      if (tr !== descriptionKey) {
        o.description = tr;
      }
    });
  }
}
