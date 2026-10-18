(module
  (import "wasi_snapshot_preview1" "path_open"
    (func $path_open (param i32 i32 i32 i32 i32 i64 i64 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1)
  (data (i32.const 100) "workspace/concord-backups")
  (data (i32.const 200) "BACKUP_READ_OK\n")
  (data (i32.const 230) "BACKUP_READ_DENIED\n")
  (func $puts (param $ptr i32) (param $len i32)
    (i32.store (i32.const 0) (local.get $ptr))
    (i32.store (i32.const 4) (local.get $len))
    (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8))))
  (func $main (export "_start")
    (local $rc i32)
    (local.set $rc
      (call $path_open
        (i32.const 3) (i32.const 0)
        (i32.const 100) (i32.const 25)
        (i32.const 0) (i64.const 2) (i64.const 2)
        (i32.const 0) (i32.const 50)))
    (if (i32.eqz (local.get $rc))
      (then (call $puts (i32.const 200) (i32.const 15)))
      (else (call $puts (i32.const 230) (i32.const 19))))
  )
)
