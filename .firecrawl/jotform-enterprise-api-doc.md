# Jotform Enterprise API Documentation (GDMO)

> Transcribed from `1773631580795-Jotform-Enterprise-API-Document-for-Government-of-Dubai-Media-Office (2).pdf` (51 pages, provided to Huzaifa Dawasaz at Government of Dubai Media Office on 08-13-2025).
> NOTE: the non-`(2)` copy of this PDF is corrupted (UTF-8 replacement bytes in binary streams) — always use the `(2)` copy.
> Base URL: `https://your-jotform-enterprise-domain.com/API` (i.e. `https://eforms.mediaoffice.ae/API`). Supplements the public Jotform API.

## 1. Jotform Sign
- **Get sign document IDs:** `GET API/listings/sign`
- **Create sign document:** `POST /API/listings/sign` — multipart form data with `file[]` (the PDF).
- **Generate sign envelopes:** `POST API/sign/#signId/send` — JSON payload `{_documentID, props: {participants: [...], hasSigningOrder, reminderInterval, expireEnabled, expirationDate, delegationEnabled, expireAfterTime, expireOnDate, expireAfterAmount, expireAfterUnit}}`.
  - Participants: required roles are participantID 1 (`role: Me`, `type: owner`) and 2 (`Signer 1`, `type: signer`); more signers increment the index; optional `CC Participant` (`type: cc`). Each participant: authenticationMethod (email), color, email, name, participantID, role, signingOrder, status (CREATED), type, username, fields (array of field IDs).
  - `reminderInterval`: unselected | everyDay … everySevenDays. `hasSigningOrder`: Yes|No (required). Other options only required when set.
- **Generate public sign link:** `PUT API/sign/#signID/invitationKey` → response contains `invitationKey`; link = `https://{slug}.jotform.com/sign/#signId/invite/#invitationKey`
- **Embed link:** same with `?signEmbed=1`; response includes `embedDocumentKey`; iframe `src="https://{slug}.jotform.com/sign/#signDocumentId/invite/#documentKey?signEmbed=1"`
- **Get signed PDF:** `GET API/inbox/sign/#signedDocumentID/downloadPDF` — returns base64. Find `#signedDocumentID` on the submission via `GET /submission/{id}?addSignDocumentData=1` (also adds `signDocument` + `auditTrailEvents`).
- **Add fields to document:** `POST /API/sign/#signDocumentId/createFields` — form data with `_documentID`, `formID`, `questions[]` (standard question props + `pdfDetails.geometry.fieldRect` = [x, height, width, y], `fieldName: id-XXXXXXXXXX` 10-digit), `annotations[]` (id/name/rect/type/pageIndex/qid/fieldName).

## 2. Prefill
1. **Create empty prefill:** `POST /API/form/{form_id}/prefills?apiKey=…` body `{"provider":"manual","account_id":"","configuration":{}}` → returns `prefill_id`.
2. **Get question keys:** `GET /API/form/{form_id}/prefills/questions?apiKey=…` → `prefill_key` list (e.g. `3-first`, `5-state`).
3. **Create prefilled URL:** `POST /API/form/{form_id}/prefills/{prefill_id}/url?apiKey=…` body `[{metadata:{name,email}, settings:{fieldBehaviour: edit|readonly, useQuestionID: true}, mapping:{prefill_key: value}}]`.
4. Date keys with `useQuestionID=true`: `24-month/24-day/24-year/24-lite-mode`; with false: `month_24` etc.
5. Fill-in-the-blanks: `qid-FIELDNAME-id` (FIELDNAME ∈ firstname, lastname, email, streetaddress, addressline2, city, state, zip, shorttext, areacode, phone, number, optionN).
   - Checkbox/Radio: `input_qid_selectbox-id`; Time: `hourSelect_qid_time-id`, `timeInput…`, `minuteSelect…`, `ampm…`; Date: `year_qid-date-id` etc.; Signature: `qid_input_signature-id` (base64).
6. View: `https://form.jotform.com/{form_id}/prefill/{id}`. List: `GET …/prefills?apiKey=`. Update: `PUT …/prefills/{prefill_id}/url/{prefill_url_id}`. Delete: `DELETE …/prefills/{prefill_id}/url` body `["{prefilled_url_id}", …]`.
- **Salesforce prefill:** `GET /API/integrations/accounts/partner/salesforceV2` (account_id) → `GET /API/integrations/options` payload `{"app":"salesforceV2","aid":…,"type":"getFields","data":{"list":"LIST"},"formID":…}` → `POST API/form/:formID/prefills` with provider salesforceV2 + mapping `[{jot: input_qid, target: salesForceFieldNameKey}]` → `getListEntries` → `POST …/prefills/:prefillID/url` with `[{"id":"itemID","metadata":{...},"settings":{"fieldBehaviour":"edit"}}]`.

## 3. Sharing
- **Add assignee:** `POST /form/{formID}/formuser/bulkAssign` (`users` array, `message`, `permission=submitAndEdit`, `isShare=0`)
- **Remove assignees:** `DELETE /form/{formID}/formuser/bulkRemove` (`emails` form-data field)
- **Share resource:** `POST share/#productType/:resourceID/bulkShare` (e.g. share/sheets/123/bulkShare) — payload `users[]`, `message`, `role: readOnly|commenter|collaborator`, `continueOnExistingEmails: Boolean`
- **Get share users:** `GET /API/share/#productType/:resourceID`
- **Update shared permissions:** `API/#productType/:resourceID/share/:shareKey/update` — `permissions[role]: readOnly|commenter|collaborator`

## 4. Teams
Always send header `jf-team-id` when fetching a resource inside a team.
- `GET /API/team/user/me` — my teams (addMemberCount, returnTeamProperties, returnMembers: 0|1)
- `GET /API/team/server/teams` — all public teams
- **Get Team ID by form ID:** `GET /API/enterprise-dashboard/server/forms?handleTeamResourceOwner=1&keyword={{form_id}}`
- `GET /API/team/#team_id` (params addSubfolders, returnMembers, returnTeamProperties, returnMembersRoles, returnMembersLastSeen) · `DELETE /API/team/#team_id`
- `GET /API/team/list/roles` · **Create:** `POST /API/team/new` (name, members[], Privacy public|private)
- Properties: `GET|PUT /API/team/#team_id/properties` (name, slug, privacy, showCoverImage, coverBgColor, coverTitleColor, coverBgImageURL, teamAvatarURL/Icon/EmojiId/IconSvgRef/IconColor/IconBgColor, coverBgImageCropInfo)
- Members: `GET /API/team/#team_id/members` (returnMembersRoles) · `POST API/team/#teamId/members` (`Members[i][email]`, `Members[i][role]: team_admin|data_collaborator|data_viewer|creator`) · `PUT /API/team/#teamId/member/#username` (role_id) · `DELETE /API/team/#teamId/member/#username` · bulk `DELETE /API/team/#teamId/members` (members[]) · bulk `PUT /API/team/#teamId/members` JSON `{members:[{username, role_id}]}`
- Resources: `GET /API/team/#teamId/assets` (favorite, getLastLog, team_offset, limit) · typed `GET /API/team/#teamId/assets/#assetType` (form, sheet, portal, workflow, report)
- **Action on asset:** `POST /team/#teamId/#assetType/#assetId/#action` (favorite, archive, unfavorite, unarchive)
- **Move asset into team:** `POST /API/team/#teamid/move/asset` — formData `v2:1`, `assets[0][id]`, `assets[0][type]` (form|sheet|portal|workflow|report|sign), `isRetry:false`
- Folders: move asset `PUT /API/listings/team/#teamid/folder/#folderID/add` (`resources[0][resource_id]`, `resources[0][resource_type]`, folder_id) · `GET /API/team/#teamid/folders` · `POST /API/team/#teamid/folder/create` (name, color) · `POST /API/team//#teamid/folder/#folderid/properties` JSON `{name, color}` · `GET /API/team/#team_id/folder/#folder_id/resources/form` (limit default 20, team_offset, order by updated_at, addProperties, includeSharedForms, getLastLog)
- `GET /team/asset/#resourceId/#resourceType` — resource + type lookup (form, sheet, portal, workflow, report, sign)
- Invite links: `GET /API/team/#teamId/invitelink` · `POST /API/team/#teamId/create/invitelink` (properties[role], properties[visibility]) · `PUT /API/team/#teamId/update/invitelink` JSON `{properties:{visibility:"private"}}`
- **Team history:** `GET /API/team/#team_id/history` (returnedGroupedData, date: allTime|last7Days|last30Days|previousWeek|previousMonth|thisYear|previousYear|range, startDate, endDate)
- **Export history:** `GET /API/team/#teamId/history/export` (date, type: xlsx|csv, sortWay, sortBy) → job id; status: `GET /API/team/#teamId/history/export/status?id=…`

## 5. PDFs
- **Jotform-styled PDF:** `GET https://{companyDomain}.jotform.com/API/generatePDF?formid={formID}&submissionid={submissionID}&download={0|1}&apiKey={apiKey}` (+optional `reportid` for non-default template)
  - Alt: `https://{serverslug}.jotform.com/API/generatePDF/{formID}/fill-pdf?download=1&reportid={pdfid}&submissionid={…}&apikey={…}`
- **Smart PDF form:** `GET /API/pdf-editor/pdf-converter/#formID/fill-pdf` (Download 0|1, submissionID)
- **Fillable blank PDF:** `GET /API/pdf-editor/generateFillablePDF` (pdfId = reportID, formId)
- **Create Smart PDF form:** `GET /API/form/new?isPdfForm=1` → formID, then `POST /API/pdf-converter/import-pdf` (pdf: binary, formID, convert2Form: 1, source: DEFAULT); edit questions via `/form/formID/questions`.

## 6. Conditions
- Get: `GET /API/form/:formID/properties` → `conditions` key. Create: `POST /API/form/:formID/conditions/create`. Update: `POST /API/form/#formid/conditions/update` (same payload). Delete: `DELETE /API/form/#formid/conditions/delete` JSON `{"condition": "[\"1702515031838\"]"}`.
- Condition object: id (alphanumeric, form-unique), index, priority, link (Any|All), terms[] `{id, field, operator, value, isError}`, type (field|page|email|url|message), disabled (1|NULL), action (stringified JSON array).
  - type meanings: field=show/hide, require=enable/disable/require/unrequire, url=change thank-you URL, message=change thank-you text, page=skip/hide page, email=change recipient, calculation.
- Action examples — Show/Hide: `{id, visibility: Hide|Show, isError, field}`; Calculate: `{replaceText, readOnly, newCalculationType, useCommasForDecimals, operands, equation "{3}", showBeforeInput, showEmptyDecimals, ignoreHiddenFields, insertAsText, id, resultField, decimalPlaces, isError}`; Enable/Require: visibility ∈ Require, Unrequire, RequireMultiple, UnrequireMultiple, Disable, Enable, Mask (+`mask` key; multiple = field array as string); skipTo: `{id, skipTo: "page-1"}`; thank-you message: `{id, message: "<html>", isError}` or `redirect` key with URL.
- Operators — Generic: isEmpty, isFilled. Text: equals, notEquals, contains, notContains, startsWith, notStartsWith, endsWith, notEndsWith. Numeric: quantityEquals, quantityNotEquals, quantityLess, quantityGreater, quantityNumeric, lessThan, greaterThan. Matrix: contains, notContains. Date: before, after, equalDate, notEqualDate, equalDay, notEqualDay. Address: equalCountry, notEqualCountry.

## 7. History
- **Instance actions:** `GET …/API/enterprise/history` — params: next (int, default 100), returnedGroupedData (bool), date (last7Days default | lastWeek | last30Days | lastMonth | last6Months | lastYear | previousWeek | previousMonth | thisYear | previousYear | range + startDate/endDate `Y-m-d 00:00:00`), sortBy: timestamp, countOnly: 1|0, sortWay: ASC|DESC (default DESC).
- Filter types — Forms: formID, username, formTitle, ip. Submissions: formID, submissionID, Username. Users: username, ip, Email.
- `action[]` filters (repeatable): User — emailChange, parentDelete, usernameChange, subuserDelete, userCreation, userLogin, webHookAdd, webHookAddManual, webHookUpdateManual, passwordChanged. Form — formCreation, formDelete, formPurge, formRestore, formUpdate, submissionDeleteAll, submissionDeleteBatch, webHookUpdate, formAssigned, formUnassigned. Submission — submissionDelete, submissionEdit.
- **System logs:** `GET …/API/enterprise/system-logs` (limit, offset, sortBy: date, sortWay, date, event[0]: email|integration)
- **Email status/content:** `GET /API/email/#emailId` (emailId from `/API/user/history` or enterprise history)

## 8. Reports
- **Create:** `POST https://{serverSlug}.jotform.com/API/sheets/{FORM_ID}/sheet/{SHEET_ID}/views` (SHEET_ID = FORM_ID). Params: config[name], config[type]=report, config[formID], config[reportTemplate]: blank|single|two, isDuplicated: false, tempTables: 0. Response → View ID + Report ID.
- **Add basic elements:** `POST …/view/{VIEW_ID}` — config[height], config[itemType]: text|header|image|shapes|icon|sheet, config[width], config[id] (6-char unique), config[left], config[pageID], config[top]. image: opacity, roundedCorners, URL (same-domain best). icon: iconCategory, iconFillColor, iconType, opacity. sheet: frozenQuestions[], hiddenQuestions[], questionOrders[] (+ "ip","created_at","updated_at","id"), questionCustomTitles {qid: title}.
- **Add questions (charts):** same endpoint — config[itemType]: chart, config[chartType]: textGrid|donut|pie|column|bar, config[chartOptions] (0 or JSON array when orderBy custom), config[entryLimit], config[infoType]: noGrid|legend|tableGrid, config[infoPosition]: top|left, config[orderBy]: desc|asc|alphabetic|custom|form, config[qid], config[text], config[id], config[left/pageID/top], config[labelResponseValueShow], config[labelPercentageTotalShow], config[isRoundedValues], config[chartColorPalette]: default_x.
- **Update element:** `POST …/view/{VIEW_ID}/report/{ELEMENT_ID}` (ELEMENT_ID = config[id]). **Delete:** `DELETE` same URL.

## 9. Users
- **Invite by email:** `POST /API/user/new` — name, email, jobTitle, account_type: USER|ADMIN|DATA_ONLY_USER, isNewAddUser: 1
- **Invite by link:** `GET API/enterprise/getInvitationId` → `https://{slug}.jotform.com/join/#id`
- **Update:** `POST /API/enterprise/update/user` — name, email, username, jobTitle, accountLockout, account_type, currentUsername, isNewAddUser
- **Delete:** `DELETE /API/user/#username` · **List:** `GET /API/users`

## 10. Product List element
- **Create coupon:** `POST /API/payment/editor/FormID/create-coupon` — code, type: percent, rate (int), limit `{"type":"none","value":""}`, apply: product, products: ["all"], gatewayType (default payment), id (int)
- **Edit:** `POST /payment/editor/#FormID/#couponID/update-coupon` · **Remove:** `POST /API/payment/editor/#formID/#couponID/delete-coupon`
- **Get coupons:** `GET /API/form/#formID/properties` → `coupons` key

## 11. Approval workflow
- **Start:** `POST /API/workflow/submission/#submissionID/start`
- **Restart:** `POST /API/sheets/#formid/workflow/instance/#workflowid/restart`
- **Status:** `GET /API/submission/#submissionID?addWorkflowStatus=1`
- **Tasks on a submission:** `GET /workflow/submission/#submissionID/tasks`
- **Approval history:** `GET /API/inbox/submission/#submissionID/thread`
- **Action an approval:** `POST /API/workflow/task/#taskID/complete` — payload `outcomeID` (int, from taskList → outcomes), `comment` (string)

## 12. Filtering
- **OR filter on submissions:** `GET /API/sheets/#formid/sheet/#formid/view/#formid/rows` with `filter={"q3:matches":"[\"foo\",\"bar\"]"}` (URL-encoded)
- Operators (strings & numbers): matches, eq, ne, lt, lte, gt, gte. Dates: matches, lt, lte, gt, gte.

## 13. Analytics / Drafts
- **Form analytics:** `GET /API/form/#formid/analytics`
- **List drafts:** `GET /API/sacl/#form_id/drafts` (not on HIPAA) · **View:** `GET /API/sacl/#form_id/draft/#draft_id`
- **Delete drafts:** `POST /API/sacl/#form-id/draft/bulkDeleteFromSheet` — form data `conditions` = `{"includes": ["draftId1","draftId2"]}`
- **Create draft:** `POST /API/sacl/#form_id/draft/create` — form data `data` = JSON `{pageNo, visitedPages, backStackHistory[], questions:[{qid, type, value:{data}}], params}`

## 14. Action Buttons
- **Create:** `POST API/sheets/#formid/sheet/#formid/view/#formid/columns?withSubmissionColumns=1` — formData: sheets:1, v2:1, column[type]: control_actionButton, column[customFieldType]: sendEmailButton|chargeNowButton|sendPDFButton|sendFormButton|requestEditButton|webhookButton, column[buttonText], column[buttonVariantID]:0, column[buttonIcon], column[text], column[order], column[actions][0][type]: sendFormEmail|sendPDFEmail|sendShareFormEmail|sendRequestEditEmail|integration, column[sheetField]: Yes, withData:0, dataSourceQid.
  - sendEmailButton: `column[actions][0][emailID]`. sendPDF: to, passwordEnabled, password, message. sendForm/sendShareFormEmail: to, message, prefillSettings (provider automation + mapping), shareFormID, prefillID null. requestEdit: to, message. webhookButton/integration: partner: webhooks, integrationID.
- **Get:** `GET API/sheets/#formid/sheet/#formid/view/#formid/columns`
- **Trigger:** `POST API/sheets/#formid/form/#formid/automation/#automationid/run` — formData `details[submissionID]`
- 3rd-party integrations (TBC): hubspot, onedrive, salesforceV2, constantContactV2, asana, mailerlite, airtable, pipedrive, monday, clickup, box-sign, twilio — `POST /API/integrations/sheet_form/#formid`

## 15. Other / Misc
- **Form revisions:** `/form/#formid/revisions`
- **List forms on server:** `GET /API/enterprise-dashboard/server/forms` — limit, offset, sortBy (id, count, …), handleTeamResourceOwner (team details), username, keyword (case-insensitive)
