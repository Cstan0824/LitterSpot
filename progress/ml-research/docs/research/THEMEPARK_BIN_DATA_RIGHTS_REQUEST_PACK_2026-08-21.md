# Theme-park bin data rights and access request pack — 2026-08-21

## Purpose and stop rule

This is an **unsent** request pack for the two remaining rights leads. No
message, form, login, archive, or image pixel was submitted or downloaded in
preparing it.

Do not put any pixel into a training, validation, test, or cache manifest until
an authorised rightsholder provides written permission (or an executed
agreement) that passes the applicable checklist below. A portal licence, code
licence, public URL, or access credential is not that permission.

| Lead | Official evidence | Exact blocker | Current decision |
| --- | --- | --- | --- |
| StreetView-Waste | The official repository describes container detection, tracking, and overflow instance segmentation, and says access is under a data-licence agreement for GDPR-compliant academic use. [Repository](https://github.com/DiogoJPaulo/StreetView-Waste#dataset-overview) | The public statement is academic-use scoped. The repository [MIT licence](https://raw.githubusercontent.com/DiogoJPaulo/StreetView-Waste/master/LICENSE) covers software/documentation, not an explicit commercial right in the pixels or labels. Official ZIP endpoints returned `401 Unauthorized` to metadata-only HEAD checks on 2026-08-21. | **NO-GO pending a written commercial data-rights and access agreement.** |
| San Francisco 311 / DataSF | The official metadata API calls `media_url` a URL to associated media, for example an image, and declares PDDL for the table. [Metadata API](https://data.sfgov.org/api/views/vw6y-z8j6) | The City's [Terms of Use](https://data.sfgov.org/terms-of-use) say its terms do not grant IP rights held by the City or others. The published schema has no per-asset author, rights, consent, or photo licence. | **NO-GO pending a written asset-scope rights confirmation or a City-curated rights-cleared release.** |

## Required answers in either written response

Ask an entity authorised to grant the rights—not merely a portal administrator—to
state, for the named files or manifest subset:

| Required answer | Why it matters |
| --- | --- |
| Who owns or controls the pixels and annotations, and who may sign the agreement? | Establishes authority. |
| Are commercial model training, evaluation, deployment, and ongoing improvement permitted? | Separates product use from academic/display use. |
| May trained checkpoints, embeddings, and other derived weights be retained and deployed? | A model can retain information from source pixels. |
| What retention, deletion, security, audit, and processing-location rules apply to pixels, annotations, backups, and derived artifacts? | Makes handling operationally verifiable. |
| What attribution, citation, notice, reporting, and branding obligations apply? | Lets the product/model card comply. |
| May pixels, labels, crops, contact sheets, weights, and benchmark results be redistributed? To whom and under what controls? | Prevents accidental disclosure or assumed publication rights. |
| Do the rights cover every released file, including third-party/citizen-contributed assets? | A dataset-level label may not cover underlying images. |
| What privacy/personal-data restrictions or redaction requirements apply? | Prevents unauthorised handling of people or plates. |

The answer should identify the source version/date, asset manifest scope,
permitted purposes, duration, territory, sublicensing position, and signatory
authority. “Publicly available,” “research use,” or “the GitHub licence
applies” is not a pass.

---

## StreetView-Waste

### Official facts and blocker

The official project page identifies the project contact as
`diogo.paulo@ubi.pt`. [Project page](https://streetview-waste.di.ubi.pt/).
Its paper describes raw public-street video from two fisheye cameras, 10-fps
annotated sampling, and video-level train/validation/test splits designed to
prevent leakage. [Acquisition and split sections](https://arxiv.org/html/2511.16440#S3).

The paper says original imagery contains faces and licence plates and that
access is managed through a formal agreement restricted to academic research
and GDPR compliance. [Privacy section](https://arxiv.org/html/2511.16440#S3.SS4).
Thus the issue is not annotation volume; it is absent commercial rights and
unsettled downstream handling terms for raw imagery, labels, and derived
weights. Do not bypass the protected
[segmentation endpoint](https://streetview-waste.di.ubi.pt/datasets/segmentation_task.zip).

### Official contact route

1. **Primary:** email `diogo.paulo@ubi.pt`, which is listed on the
   [official project page](https://streetview-waste.di.ubi.pt/), and ask for
   the data controller/rightsholder and agreement process.
2. **Fallback:** use the public
   [repository issues page](https://github.com/DiogoJPaulo/StreetView-Waste/issues)
   only to ask a non-sensitive access-routing question. Do not post personal
   data, business terms, or a rights request in a public issue.

### Unsent permission request

**To:** `diogo.paulo@ubi.pt`
**Subject:** Request for StreetView-Waste access and commercial ML data licence

> Dear Dr. Paulo,
>
> We are evaluating StreetView-Waste for a trash-bin localisation and
> overflow-state system deployed in commercial theme-park operations. We will
> not download or use any dataset pixels until the permitted use and data-use
> agreement are clear.
>
> Could you please identify the data controller/rightsholder and provide the
> applicable data-licence agreement? We request written permission, if
> available, to use a defined StreetView-Waste subset for commercial model
> training, validation, evaluation, deployment, and ongoing improvement.
>
> Please explicitly confirm whether we may retain and use trained model
> weights, embeddings, and other derived artifacts; store authorised pixels,
> annotations, and backups under agreed security/retention controls; and
> publish or share only the aggregate results and derived artifacts that you
> permit. Please provide all attribution, citation, reporting, redistribution,
> deletion, territory, and GDPR requirements.
>
> Please also state whether the permission covers original imagery, container
> boxes, tracking IDs, overflow masks, and derived crops/contact sheets. If
> commercial use is unavailable, please confirm that clearly and identify any
> redacted or separately licensed subset, if one exists.
>
> For leakage-safe evaluation, could you provide or confirm the schema and
> frame/container/mask joins listed below, including the video/session group
> that must remain together across splits?
>
> Thank you,
> [name, organisation, country, product contact]

### Requested schema and grouping fields

The paper establishes video-level splits and tracks but does not publish the
file-level join from an overflow mask to a parent container. [Task and
statistics sections](https://arxiv.org/html/2511.16440#S3.SS2). Request:

| Field or document | Required use |
| --- | --- |
| Dataset version, file manifest, checksums, agreement ID | Reproducibility and rights scope. |
| `image_id`/filename, video ID, session ID, camera ID, frame index, timestamp or order key | Keep temporally correlated frames together. |
| Official split plus group key used to form it | Preserve supplier video-level separation. |
| Container annotation ID, box, class, persistent track ID | Identify the physical bin where possible. |
| Overflow mask ID, mask encoding, source image, positive/negative definition, parent-container ID | Train overflow attributable to a bin rather than generic litter. |
| Frame → container → mask join table, or a statement that it does not exist | Required for the per-bin state target. |
| Visibility/occlusion, image-quality, anonymisation/redaction flags | Stratify known false positives safely. |
| Rights/provenance, use scope, retention/deletion terms, attribution, redistribution rule | Enforce the agreement in the manifest. |

### Go / no-go response checklist

| Check | Go only when | No-go when |
| --- | --- | --- |
| Commercial purpose | Authorised response explicitly permits commercial train/evaluate/deploy for named files. | Terms stay academic/research-only or silent. |
| Derived weights | Response explicitly permits retained/deployed weights and states deletion rules. | Access is granted but weights are not covered. |
| Privacy and security | Agreement specifies GDPR/controller duties, redaction status, storage, and deletion. | Product cannot meet raw face/plate obligations. |
| Pixel and label scope | Agreement covers pixels, boxes, tracks, masks, and intended derived crops/contact sheets. | Only code, paper, or benchmark use is licensed. |
| Redistribution | Restrictions are explicit and compatible with intended sharing. | Needed sharing rights are prohibited or unspecified. |
| Parent-bin relation | A usable join exists, or written permission allows documented human review to create it. | Masks cannot be tied to a bin and derivation is not allowed. |
| Leakage grouping | Video/session group identifiers and split rules are supplied. | Frames cannot be reliably grouped. |
| Attribution | Required notices/citation are supplied and can be retained. | Obligations cannot be met. |

**Admission:** annotation-only staging is allowed only after all commercial,
privacy, and scope checks pass. Training also requires the join and leakage
checks to pass.

---

## San Francisco 311 / DataSF attached media

### Official facts and blocker

The [official 311 Cases metadata API](https://data.sfgov.org/api/views/vw6y-z8j6)
defines `Media URL` as “a URL to media associated with the request, e.g. an
image,” identifies `CaseID` as a unique service-request ID, and exposes
category, subtype/detail, source, timestamps, geography, and agency fields. It
labels the table PDDL.

PDDL for the table is not an image-rights ledger. The City's
[Terms of Use](https://data.sfgov.org/terms-of-use) say data can be compiled
and processed by the City and third parties and do not grant IP rights the City
or others may have. The official [SF311 dataset explainer](https://sfdigitalservices.gitbook.io/dataset-explainers/311-cases)
also describes the data as crowdsourced and says the City may retract pictures
for privacy. Therefore, a public `media_url` is a candidate review queue,
not licence-safe visual ground truth.

### Official contact route

1. **Primary:** use the official [Contact Owner for 311 Cases form](https://data.sfgov.org/datasets/vw6y-z8j6/contact).
   It states that the sender's email will be shared with the dataset owner.
2. **Routing fallback:** `support@datasf.org`, listed on the official
   [DataSF page](https://www.sf.gov/departments--city-administrator--datasf),
   asking DataSF to route the request to San Francisco 311, the data owner,
   and the City party authorised to approve third-party/citizen media rights.
3. **SF311 service route:** the official [SF311 feedback page](https://sf311.org/services/feedback)
   can identify the customer-service channel, but it is not by itself a licence
   grant route.

### Unsent permission request

**To:** 311 Cases dataset owner via Contact Owner form; use
`support@datasf.org` only for routing
**Subject:** Rights clarification for SF311/DataSF attached media in commercial bin-overflow ML

> Dear 311 Cases dataset owner / DataSF team,
>
> We are evaluating whether a narrowly defined, City-authorised set of
> SF311/DataSF attached media could be used to train and evaluate a commercial
> trash-bin localisation and overflow-state system. We understand that
> `media_url` indicates media associated with a service request and that
> DataSF terms do not themselves grant third-party intellectual-property
> rights. We will not download, cache, or train on attached images until the
> authorised rightsholder confirms the permitted use in writing.
>
> Please identify the City entity and, where relevant, third-party process that
> can authorise use of attached media. For an asset manifest that you designate
> as rights-cleared, please explicitly confirm whether commercial training,
> validation, evaluation, deployment, and model improvement are permitted.
>
> Please also confirm whether trained model weights, embeddings, and aggregate
> evaluation outputs may be retained and deployed; specify pixel/annotation
> storage, retention, deletion, security, and geographic-processing rules; and
> provide required attribution, notices, and all restrictions on redistribution
> of pixels, annotations, crops/contact sheets, weights, and benchmark outputs.
>
> We need a City-curated manifest or equivalent evidence that every permitted
> asset is owned by or licensed to the City with rights sufficient for those
> uses, including citizen- or third-party-submitted photos. If no such
> permission can be granted, please confirm that outcome; we will exclude all
> attached media.
>
> To make a later review leakage-safe and privacy-aware, please provide or
> identify the available fields listed below, including a stable media ID and a
> privacy-preserving grouping key for repeated reports of the same bin/site.
> We will treat service-request route text as a candidate queue rather than a
> visual state label unless an authorised reviewer creates an annotation.
>
> Thank you,
> [name, organisation, country, product contact]

### Requested schema and grouping fields

Ask the authorised City source to provide these in an asset manifest or state
they are unavailable:

| Field or document | Required use |
| --- | --- |
| Immutable `media_id`, `CaseID`, original URL, checksum, active/revoked flag, replacement relationship | Reconcile changing URLs safely. |
| Asset creator/rightsholder class, authorisation source, asset-specific permission/licence ID, agreement version, authorised use scope | Prove that each image—not merely its database row—is rights-cleared. |
| Upload/capture time or permitted time bucket, submitter/source type, original-submission/group ID | Keep related submissions and repeat uploads in one split. |
| Privacy-safe site/bin group or duplicate cluster and permitted coarse location group | Prevent physical-bin/site leakage without disclosing exact sensitive locations. |
| Published service name, subtype, detail, agency, status, update/closure time, location fields | Sample candidate positives/hard negatives while retaining provenance. |
| Direct original vs transformed derivative vs broken link vs third-party landing-page flag | Exclude non-authorised/non-image assets. |
| Consent/notice, face/plate/PII flag, redaction version, legal basis, retention/deletion and security terms | Apply the permitted privacy process per file. |
| Visual review label, reviewer/date, bin box/mask, parent-bin relation, overflow definition, QA status | Convert complaint routing into auditable ground truth if annotation is allowed. |

### Go / no-go response checklist

| Check | Go only when | No-go when |
| --- | --- | --- |
| Authority | Response comes from a City entity/rightsholder authorised to license named media. | Reply is only portal/support guidance. |
| Asset scope | Curated manifest/equivalent identifies exact files and rights/provenance. | Permission covers only table, URL field, or public-record status. |
| Citizen/third-party photos | Response expressly covers their copyright/permission chain or excludes them. | Rights are assumed from submission or PDDL. |
| Commercial and derived use | Train/evaluate/deploy/improve and derived weights/embeddings are explicit. | Any is non-commercial, research-only, display-only, or silent. |
| Privacy | Approved process exists for PII, storage, deletion, and nondisclosure. | Duties cannot be operationally met. |
| Redistribution | Constraints cover pixels, labels, examples, weights, and results. | Intended sharing needs ungranted rights. |
| Grouping | Stable privacy-safe group key or approved grouping mitigation exists. | Repeated site/bin reports cannot be held together. |
| Ground truth | Authorised human review/annotation occurs before a row is labelled overflow, non-overflow, or edge case. | Complaint type is used as a visual label. |
| Attribution/audit | Required notices and provenance ledger requirements are supplied. | Requirements cannot be met. |

**Admission:** even a rights-cleared image is only a candidate-review item
first. It becomes a state-training row only after an authorised review proves a
visible bin, parent-bin relationship, and intended state/edge-case label.

## After a permission response arrives

1. Store the written response and agreement reference in a restricted
   provenance ledger; never expose credentials in Git, logs, or screenshots.
2. Run an annotation/schema-only audit before pixel acquisition.
3. Acquire only the permitted manifest subset, hash it, and retain its rights
   and attribution fields beside every training row.
4. Perform a stratified contact-sheet review for bin/rim relation and known
   false-positive classes.
5. Re-run the dataset sufficiency gate. Do not start either training loop until
   all outstanding no-go checks close.

## Primary-source links

- [StreetView-Waste project](https://streetview-waste.di.ubi.pt/)
- [StreetView-Waste repository](https://github.com/DiogoJPaulo/StreetView-Waste)
- [StreetView-Waste paper](https://arxiv.org/html/2511.16440)
- [DataSF 311 Cases catalogue](https://data.sfgov.org/City-Infrastructure/311-Cases/vw6y-z8j6/about_data)
- [DataSF 311 metadata API](https://data.sfgov.org/api/views/vw6y-z8j6)
- [DataSF Terms of Use](https://data.sfgov.org/terms-of-use)
- [SF311 dataset explainer](https://sfdigitalservices.gitbook.io/dataset-explainers/311-cases)
