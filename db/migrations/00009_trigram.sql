-- +goose Up
-- Substring search for German compounds: "brot" must find Vollkornbrot. Word-prefix FTS cannot.
CREATE VIRTUAL TABLE foods_trgm USING fts5(
    name, brand,
    content='foods', content_rowid='rowid',
    tokenize='trigram remove_diacritics 1'
);

-- +goose StatementBegin
CREATE TRIGGER foods_trgm_ai AFTER INSERT ON foods BEGIN
    INSERT INTO foods_trgm(rowid, name, brand) VALUES (new.rowid, new.name, new.brand);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER foods_trgm_ad AFTER DELETE ON foods BEGIN
    INSERT INTO foods_trgm(foods_trgm, rowid, name, brand) VALUES ('delete', old.rowid, old.name, old.brand);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER foods_trgm_au AFTER UPDATE ON foods BEGIN
    INSERT INTO foods_trgm(foods_trgm, rowid, name, brand) VALUES ('delete', old.rowid, old.name, old.brand);
    INSERT INTO foods_trgm(rowid, name, brand) VALUES (new.rowid, new.name, new.brand);
END;
-- +goose StatementEnd

CREATE VIRTUAL TABLE catalog_trgm USING fts5(
    name, brand,
    content='catalog_foods', content_rowid='rowid_alias',
    tokenize='trigram remove_diacritics 1'
);

-- +goose StatementBegin
CREATE TRIGGER catalog_trgm_ai AFTER INSERT ON catalog_foods BEGIN
    INSERT INTO catalog_trgm(rowid, name, brand) VALUES (new.rowid_alias, new.name, new.brand);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER catalog_trgm_ad AFTER DELETE ON catalog_foods BEGIN
    INSERT INTO catalog_trgm(catalog_trgm, rowid, name, brand) VALUES ('delete', old.rowid_alias, old.name, old.brand);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER catalog_trgm_au AFTER UPDATE ON catalog_foods BEGIN
    INSERT INTO catalog_trgm(catalog_trgm, rowid, name, brand) VALUES ('delete', old.rowid_alias, old.name, old.brand);
    INSERT INTO catalog_trgm(rowid, name, brand) VALUES (new.rowid_alias, new.name, new.brand);
END;
-- +goose StatementEnd

INSERT INTO foods_trgm(foods_trgm) VALUES ('rebuild');
INSERT INTO catalog_trgm(catalog_trgm) VALUES ('rebuild');

-- +goose Down
DROP TRIGGER catalog_trgm_au;
DROP TRIGGER catalog_trgm_ad;
DROP TRIGGER catalog_trgm_ai;
DROP TABLE catalog_trgm;
DROP TRIGGER foods_trgm_au;
DROP TRIGGER foods_trgm_ad;
DROP TRIGGER foods_trgm_ai;
DROP TABLE foods_trgm;
