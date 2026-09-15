// A caption written by a grabbit import sidecar ends with "Source: <url>" —
// the link the clip or image was grabbed from. Posts still carry that grammar,
// so the regex outlived the shorts module it was written for: the feed strips
// the line before rendering and shows the host as a small credit instead.
//
// Kept in a module of its own because both a client component and the server
// importer need it, and neither should pull the other's dependencies in.
export const SOURCE_RE = /(?:^|\s)Source:\s*(https?:\/\/\S+)/i;
