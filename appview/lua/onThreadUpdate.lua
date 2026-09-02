-- record.update:app.atmobb.discussion.thread
-- Keep the stats row's title in step with an edited thread. Edits don't
-- count as activity, so last_activity stays where it was.
function handle()
  if record and record.title then
    db.raw([[
      UPDATE atmobb_thread_stats SET title = $2 WHERE thread_uri = $1
    ]], { uri, record.title })
  end
  return record
end
