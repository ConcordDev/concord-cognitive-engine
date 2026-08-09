class_name TerrainTextureLoader
extends Node
## TerrainTextureLoader — downloads a real terrain texture (JPG/PNG) over
## HTTP and decodes it into a usable ImageTexture. Mirrors assets/
## glb_loader.gd's shape exactly (same HTTPRequest lifecycle, same
## accept_gzip=false fix for the real Next.js-dev-server gzip-decode defect
## that file's own header comment documents, same never-fabricate-on-
## failure contract).
##
## Honest failure: on any HTTP error, non-200 status, unsupported
## extension, or image-decode error, `load_failed` fires and no texture is
## returned -- the caller's existing solid-color material (see
## world/boot.gd's ground plane) is left exactly as it was, never swapped
## for a broken or fabricated texture.

signal loaded(url: String, texture: ImageTexture)
signal load_failed(url: String, reason: String)


func load_texture(url: String) -> void:
	var req := HTTPRequest.new()
	add_child(req)
	req.accept_gzip = false
	req.request_completed.connect(_on_completed.bind(url, req))
	var err := req.request(url)
	if err != OK:
		load_failed.emit(url, "request_error_%d" % err)
		req.queue_free()


func _on_completed(
		result: int, code: int, _headers: PackedStringArray,
		body: PackedByteArray, url: String, req: HTTPRequest) -> void:
	req.queue_free()
	if result != HTTPRequest.RESULT_SUCCESS:
		load_failed.emit(url, "http_result_%d" % result)
		return
	if code != 200:
		load_failed.emit(url, "http_status_%d" % code)
		return

	var lower := url.to_lower()
	var img := Image.new()
	var decode_err: int
	if lower.ends_with(".jpg") or lower.ends_with(".jpeg"):
		decode_err = img.load_jpg_from_buffer(body)
	elif lower.ends_with(".png"):
		decode_err = img.load_png_from_buffer(body)
	else:
		load_failed.emit(url, "unsupported_format")
		return
	if decode_err != OK:
		load_failed.emit(url, "decode_error_%d" % decode_err)
		return

	var tex := ImageTexture.create_from_image(img)
	loaded.emit(url, tex)
