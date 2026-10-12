import { Injectable, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private readonly updates = inject(SwUpdate);
  readonly ready = signal(false);
  readonly applying = signal(false);
  readonly error = signal('');
  private checking = false;

  constructor() {
    if (this.updates.isEnabled) {
      this.updates.versionUpdates.pipe(takeUntilDestroyed()).subscribe(event => {
        if (event.type === 'VERSION_READY') this.ready.set(true);
      });
    }
  }

  async check() {
    if (!this.updates.isEnabled || this.checking) return;
    this.checking = true;
    try {
      await this.updates.checkForUpdate();
    } catch {
      // Keep the app usable offline; retry when it regains focus or connectivity.
    } finally {
      this.checking = false;
    }
  }

  async apply() {
    if (!this.ready() || this.applying()) return;
    this.applying.set(true);
    this.error.set('');
    try {
      if (await this.updates.activateUpdate()) {
        location.reload();
      } else {
        this.error.set('Chưa thể cập nhật. Thầy cô vui lòng thử lại.');
      }
    } catch {
      this.error.set('Chưa thể cập nhật. Kiểm tra kết nối và thử lại.');
    } finally {
      this.applying.set(false);
    }
  }
}
