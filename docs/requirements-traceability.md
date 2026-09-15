# LitterSpot requirements traceability

## 1. Purpose

This matrix maps technical specification groups to their owning implementation and strongest automated evidence. Individual tests may cover more than one requirement.

## 2. Cross-cutting system requirements

| IDs | Primary implementation | Main evidence |
| --- | --- | --- |
| SYS-001 to SYS-003 | `authenticateUser`, `requireRole`, Site-scoped service reads | `auth.integration`, `identity.integration`, `operations.integration`, `retiredProcessingRoutes.integration` |
| SYS-004 and SYS-005 | `persistence`, revision checks, operation keys, guarded commands | `persistence.test`, Camera, Work, identity, and Orchestrator integration suites |
| SYS-006 to SYS-009 | `app.ts`, request context, Firestore error mapping, health clients | `app.test`, `firestoreErrors.test`, `operations.integration` |
| SYS-010 | `firebaseTargetSafety`, `databaseSafety` | matching unit tests and read-only production schema validation |
| SYS-011 | Primary Root-gated routes plus generic location compatibility routes | route source audit and `OperationsConsole.cameraAccess.test`; the compatibility-route limitation has no enforcing regression test |

## 3. Site and spatial administration

| IDs | Primary implementation | Main evidence |
| --- | --- | --- |
| SITE-001 to SITE-004 | `superadminService`, `identityService`, account routes | `identity.integration`, `operations.integration`, Superadmin frontend tests |
| SITE-005 to SITE-009 | `mapGeometry`, `mapService`, `SiteMapViewer` | `mapGeometry.test`, `siteMap.integration`, map interaction and grid tests |
| SITE-010 and SITE-011 | `cameraPlacementService`, `cameraDraftService`, movement operations | `siteMap.integration`, `camera.integration`, Camera Creation tests |
| SITE-012 | `cameraRemovalService` | `cameraRemoval.integration`, Camera Operations tests |
| SITE-013 | `siteOperationService`, Superadmin status routes | `operations.integration` |

## 4. Camera monitoring and AI

| IDs | Primary implementation | Main evidence |
| --- | --- | --- |
| CAM-001 to CAM-003 | Camera Creation routes and services, source policy | `camera.integration`, `cameraPolicy.test`, Camera Creation tests |
| CAM-004 to CAM-006 | `monitoringLease`, runtime registry, monitoring routes and service | `monitoringLease.test`, `monitoring.integration` |
| CAM-007 and CAM-008 | shared `cameraMonitoring`, `liveMonitoringService` | sampling policy test, cadence test, quota integration test |
| CAM-009 to CAM-014 | shared `delayedCameraPlayback`, Camera Live View | delayed playback and Camera Live View tests; browser Camera checks |
| CAM-015 | FastAPI main, schemas, and pipeline | AI-service `unittest` suite |

## 5. Alert and evidence management

| IDs | Primary implementation | Main evidence |
| --- | --- | --- |
| ALERT-001 to ALERT-004 | `alertPolicy`, observation normalization | `alertPolicy.test`, monitoring integration |
| ALERT-005 to ALERT-008 | `alertService`, local media, active keys | monitoring, Work, and media-retention integration suites |
| ALERT-009 and ALERT-010 | Alert routes and Work Verification | Work and retired-boundary integration suites; Alert page tests |

## 6. Cleaner and Work operations

| IDs | Primary implementation | Main evidence |
| --- | --- | --- |
| WORK-001 and WORK-002 | `cleanerAvailability`, Cleaner and map services | `cleanerAvailability.test`, `cleaner.integration` |
| WORK-003 to WORK-007 | `workOrderService`, Cleaner self routes, media service | `workOrder.integration`, Cleaner mobile tests |
| WORK-008 to WORK-011 | Work policy, Verification and guarded mutations | `workPolicy.test`, Work and Orchestrator integration suites |
| WORK-012 | notification service, operations and Cleaner inbox routes | `operations.integration`, frontend notification clients |

## 7. Orchestration and operational intelligence

| IDs | Primary implementation | Main evidence |
| --- | --- | --- |
| OPS-001 to OPS-007 | Orchestrator triggers, worker, service, provider, and commit guard | Orchestrator unit and integration suites; assignment tests |
| OPS-008 | System service and frontend System page | `operations.integration`, System client tests |
| OPS-009 to OPS-011 | Phase 11 minute, daily, dashboard, and bin-placement services | `phase11Service.test`, `phase11.integration`, bin-placement frontend tests |
| OPS-012 | audit middleware and audit service | `operations.integration`, Site Map and identity integration suites |

## 8. Release evidence

The complete current gate is listed in [testing.md](testing.md) and [release-checklist.md](release-checklist.md). Passing unit tests without the emulator suite is insufficient for a release that changes Firebase contracts, authentication, routing, or transactional workflows.
