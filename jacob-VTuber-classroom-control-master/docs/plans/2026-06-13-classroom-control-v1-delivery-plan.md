# Classroom Control V1 Delivery Plan

## Goal

Deliver a classroom-ready version that can manage at least 16 Jacob VTuber
devices on the same LAN from one Windows teacher computer.

## Scope Assessment

| Area | Feasibility | V1 approach |
|---|---|---|
| 16-device monitoring | High | Async HTTP requests with bounded concurrency and per-device timeout |
| File distribution | High | Multipart upload to one device, group, or all enabled devices |
| Work collection | High | Concurrent profile ZIP download with per-device result reporting |
| Device discovery | Medium | Concurrent CIDR scan of a teacher-selected LAN range |
| Authentication | High | Per-device classroom token sent in `X-Classroom-Token` |
| Device thumbnails | Medium | Student browser periodically uploads a compressed classroom snapshot |
| Profile recovery | High | Versioned profile workspace state plus backward-compatible migration |
| Small Windows executable | High | PyInstaller package that starts the local server and opens the browser |
| Full remote desktop control | Out of V1 | Keep Veyon integration as an optional later phase |

## Acceptance Targets

### Device Management

- Register, edit, delete, enable, disable, and group devices.
- Refresh 16 online devices in less than 3 seconds on the local test rig.
- Refresh 16 devices with 4 offline devices in less than 5 seconds.
- One offline device must not block status updates from other devices.
- Each result includes latency, last successful contact, and a readable error.

### Authentication and Discovery

- Classroom management APIs reject an invalid token with HTTP 401.
- Teacher console stores and sends a token per device.
- CIDR discovery scans at least a `/24` range with bounded concurrency.
- Discovered devices can be imported without retyping their address.

### File Distribution and Collection

- Teacher can distribute one file to one device, a group, selected devices, or all devices.
- The UI reports success, failure, timeout, and skipped devices separately.
- Unsafe filenames and path traversal are rejected.
- A 5 MB file can be distributed to 16 local simulated devices without hanging.
- Collection downloads a valid ZIP for every device with a current profile.

### Thumbnail

- Student UI uploads a JPEG or PNG snapshot no larger than 1 MB.
- Teacher cards show the latest snapshot and its age.
- Snapshot refresh does not exceed one upload every 5 seconds by default.
- Missing or stale snapshots fall back to a clear placeholder.

### Profile Recovery

- Profile format has an explicit schema version.
- Character/persona, avatar mode and selection, background state, and classroom
  files survive save, restart, and load.
- Existing V0 profiles containing only `character_config` still load.
- Export ZIP includes profile metadata, files, and the latest snapshot.

### Windows Delivery

- One documented command builds the teacher console package.
- The packaged application starts the local service and opens the browser.
- Runtime data is stored outside the packaged executable.

## Work Breakdown

1. Baseline and test harness
2. Student device identity and token authentication
3. Async teacher-side client and 16-device status cache
4. Device grouping and bulk lock/unlock/refresh/collection
5. File distribution APIs and teacher UI
6. CIDR device discovery
7. Student snapshot upload and teacher thumbnail display
8. Versioned Profile workspace state and migration
9. Windows build scripts and deployment guide
10. Local 16-device simulation, load tests, fault tests, and final report

## Non-goals

- Keyboard/mouse remote control of the Raspberry Pi desktop
- Operating-system lock screen, reboot, shutdown, or process management
- WAN/cloud management
- Replacing Veyon for full remote-desktop supervision

## Completion Evidence

Completed and verified on June 13, 2026:

- Student classroom API and profile isolation tests: 19 passed.
- Teacher console unit and real HTTP integration tests: 10 passed.
- The integration rig started 16 simulated student HTTP services, distributed a
  5 MB file to every device, locked all devices, proxied a real PNG snapshot,
  and collected 16 valid ZIP files.
- The fault test kept 12 devices online and 4 offline without exceeding the
  five-second refresh acceptance limit.
- Frontend production build completed successfully with 2,053 modules.
- The packaged `JacobTeacherConsole.exe` started independently, served its API,
  and rendered 16 device cards with no browser console errors.
- Browser checks passed at the default desktop viewport and at 390 px mobile
  width with no horizontal overflow.
- Windows single-file package size: 45,228,397 bytes (about 43.1 MiB).

The remaining field activity is deployment on the school's actual switch and
Raspberry Pi hardware. That is an operational pilot, not an unimplemented V1
software feature.
