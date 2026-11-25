-- Shared conversion fixture. The frozen input predates the optional recipe and preset fields.
INSERT INTO page(id,url,title,first_seen_at,last_seen_at) VALUES ('shared-page','https://fixture.test/reading','Fixture',1,1);
INSERT INTO selection(id,page_id,text,created_at) VALUES ('shared-selection','shared-page','Legacy passage 你好',2);
INSERT INTO llm_run(id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,input_json,response_raw,status,created_at,owner)
VALUES ('shared-run','shared-selection','explain','openai-compatible','fixture','1','Saved instruction',
'{"selection":"Legacy passage 你好","pageTitle":"Fixture","pageUrl":"https://fixture.test/reading"}',
'{"provider":"openai-compatible","remote":{"baseUrl":"https://fixture.test/v1","model":"fixture","temperature":0.3},"systemPrompt":"Saved instruction","userPrompt":"Exact old prompt","context":{"selection":"Legacy passage 你好","pageTitle":"Fixture","pageUrl":"https://fixture.test/reading"}}',
'Legacy answer 🌱','completed',3,'11111111-1111-4111-8111-111111111111');
INSERT INTO explanation_fts(rowid,body) SELECT rowid,response_raw FROM llm_run;
INSERT INTO bookmark VALUES ('shared-selection',4);
INSERT INTO interaction(id,selection_id,event_type,created_at) VALUES ('legacy-interaction','shared-selection','view',5);
INSERT INTO history_migration VALUES ('old-import');
PRAGMA user_version=4;
