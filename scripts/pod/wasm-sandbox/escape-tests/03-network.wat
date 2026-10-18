(module
  ;; If the host wrongly enables wasi:sockets TCP, this import links and we try to use it.
  ;; Under Concord lockdown (-S tcp=n) instantiation must fail → NETWORK blocked.
  (import "wasi_snapshot_preview1" "sock_open"
    (func $sock_open (param i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1)
  (data (i32.const 100) "NETWORK_REACHABLE_LEAK\n")
  (func $main (export "_start")
    (local $fd i32)
    ;; AF_INET=1, SOCK_STREAM=1
    (local.set $fd (call $sock_open (i32.const 1) (i32.const 1) (i32.const 0)))
    (i32.store (i32.const 0) (i32.const 100))
    (i32.store (i32.const 4) (i32.const 23))
    (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)))
  )
)
