-- Two completed attempts for one passage. The follow-up quotes the older answer.
INSERT INTO page(id,url,title,first_seen_at,last_seen_at)
VALUES ('search-page','https://fixture.test/prompt-search','Fixture title',1,1);
INSERT INTO selection(id,page_id,text,created_at)
VALUES ('search-selection','search-page','Original passage',2);
INSERT INTO llm_run(id,selection_id,widget_id,provider,model,prompt_version,prompt_raw,context_json,input_json,response_raw,status,created_at)
SELECT id,'search-selection','explain','openai-compatible','fixture','1','Saved instruction',context,
  json_object('provider','openai-compatible','remote',json_object('baseUrl','https://fixture.test/v1','model','fixture','temperature',0.3),
              'systemPrompt','Saved instruction','userPrompt',prompt,'context',json(context)),
  answer,'completed',created
FROM (
  SELECT 'search-old' AS id,'Archived: first question only — why 50%_exact?' AS prompt,
         'The quoted older answer' AS answer,3 AS created
  UNION ALL
  SELECT 'search-new','The quoted older answer. Follow-up: what changed?','Latest response',4
) CROSS JOIN (SELECT '{"selection":"Original passage","pageTitle":"Fixture title","pageUrl":"https://fixture.test/prompt-search"}' AS context);
INSERT INTO explanation_fts(rowid,body)
SELECT rowid,response_raw FROM llm_run WHERE selection_id='search-selection';
