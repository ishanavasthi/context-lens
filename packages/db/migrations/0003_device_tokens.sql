-- Adds device bearer tokens so the API can authenticate requests without a session cookie.

alter table devices add column token_hash bytea unique;
