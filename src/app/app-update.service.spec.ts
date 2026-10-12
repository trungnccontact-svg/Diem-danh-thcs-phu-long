import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppUpdateService } from './app-update.service';

describe('AppUpdateService', () => {
  let events: Subject<VersionEvent>;
  let worker: { isEnabled: boolean; versionUpdates: Subject<VersionEvent>; checkForUpdate: jasmine.Spy; activateUpdate: jasmine.Spy };
  let service: AppUpdateService;

  beforeEach(() => {
    events = new Subject<VersionEvent>();
    worker = { isEnabled: true, versionUpdates: events,
      checkForUpdate: jasmine.createSpy().and.resolveTo(false),
      activateUpdate: jasmine.createSpy().and.resolveTo(false) };
    TestBed.configureTestingModule({ providers: [{ provide: SwUpdate, useValue: worker }] });
    service = TestBed.inject(AppUpdateService);
  });

  it('offers an update only after download finishes, without activating it automatically', () => {
    events.next({ type: 'VERSION_DETECTED', version: { hash: 'new' } });
    expect(service.ready()).toBeFalse();
    events.next({ type: 'VERSION_READY', currentVersion: { hash: 'old' }, latestVersion: { hash: 'new' } });
    expect(service.ready()).toBeTrue();
    expect(worker.activateUpdate).not.toHaveBeenCalled();
  });

  it('retries after a network failure and avoids overlapping checks', async () => {
    let rejectCheck!: (reason: Error) => void;
    worker.checkForUpdate.and.returnValue(new Promise<boolean>((_, reject) => rejectCheck = reject));
    const first = service.check();
    await service.check();
    expect(worker.checkForUpdate).toHaveBeenCalledTimes(1);
    rejectCheck(new Error('offline'));
    await first;
    worker.checkForUpdate.and.resolveTo(false);
    await service.check();
    expect(worker.checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it('keeps the update available when activation fails', async () => {
    events.next({ type: 'VERSION_READY', currentVersion: { hash: 'old' }, latestVersion: { hash: 'new' } });
    worker.activateUpdate.and.rejectWith(new Error('offline'));
    await service.apply();
    expect(service.ready()).toBeTrue();
    expect(service.applying()).toBeFalse();
    expect(service.error()).toContain('thử lại');
  });
});
