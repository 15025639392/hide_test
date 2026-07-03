#ifndef TRACK_FFI_H
#define TRACK_FFI_H

#ifdef __cplusplus
extern "C" {
#endif

char *track_process_json(const char *input);
char *track_process_evidence_jsonl(const char *input);
char *track_process_evidence_jsonl_product_snapshot(const char *input);
void track_free_string(char *ptr);

#ifdef __cplusplus
}
#endif

#endif
