-- Where a day's visitors came from: the host of the Referer on a browser's first page of the day (server/visits.ts), never the
-- address behind it. A visit with none, or from this site's own pages, has no row.
CREATE TABLE visit_sources (day INTEGER NOT NULL, source TEXT NOT NULL, visitors INTEGER NOT NULL, PRIMARY KEY (day, source));
