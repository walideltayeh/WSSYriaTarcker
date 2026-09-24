-- Copy to a real migration and put YOUR OWN hashes in. Never commit the real ones.
-- Generate with:  node -e "console.log(require('crypto').createHash('sha256').update('your code').digest('hex'))"
INSERT OR REPLACE INTO meta (key,value) VALUES ('access_hash','<sha256 of the shared access code>');
INSERT OR REPLACE INTO meta (key,value) VALUES ('admin_hash','<sha256 of the owner password>');
INSERT OR REPLACE INTO meta (key,value) VALUES ('entry_hash','<sha256 of the accountant's entry password>');
