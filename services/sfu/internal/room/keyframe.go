package room

import "strings"

// isKeyframe reports whether an RTP payload begins a decodable frame.
//
// This matters for exactly one reason: switching a subscriber from one
// simulcast layer to another mid-frame hands their decoder a picture that
// references frames it never received, which shows up as several seconds
// of green smear or a frozen image. Waiting for a keyframe is what makes a
// layer switch invisible.
//
// Only the codecs Raven forwards video in are handled. Audio needs none of
// this (every packet is independently decodable), and an unknown video
// codec returns false, which is the safe answer: the layer switch simply
// waits, and a PLI eventually forces a keyframe anyway.
func isKeyframe(mimeType string, payload []byte) bool {
	switch {
	case strings.EqualFold(mimeType, "video/VP8"):
		return isVP8Keyframe(payload)
	case strings.EqualFold(mimeType, "video/H264"):
		return isH264Keyframe(payload)
	case strings.EqualFold(mimeType, "video/VP9"):
		return isVP9Keyframe(payload)
	default:
		return false
	}
}

// isVP8Keyframe parses just enough of the VP8 payload descriptor (RFC 7741
// §4.2) to reach the frame header's keyframe bit.
//
// The descriptor is variable-length: a bitmask byte says which optional
// fields follow, so the payload header's offset has to be computed rather
// than assumed.
func isVP8Keyframe(payload []byte) bool {
	if len(payload) < 1 {
		return false
	}

	offset := 1
	extended := payload[0]&0x80 != 0
	startOfPartition := payload[0]&0x10 != 0
	partitionIndex := payload[0] & 0x07

	// Only the first partition of a frame carries the frame header; a
	// continuation packet has no keyframe bit to read.
	if !startOfPartition || partitionIndex != 0 {
		return false
	}

	if extended {
		if len(payload) < 2 {
			return false
		}
		x := payload[1]
		offset = 2
		if x&0x80 != 0 { // PictureID present: 1 or 2 bytes
			if len(payload) < offset+1 {
				return false
			}
			if payload[offset]&0x80 != 0 {
				offset += 2
			} else {
				offset++
			}
		}
		if x&0x40 != 0 { // TL0PICIDX
			offset++
		}
		if x&0x20 != 0 || x&0x10 != 0 { // TID/KEYIDX share one byte
			offset++
		}
	}

	if len(payload) <= offset {
		return false
	}
	// VP8 frame header, first byte: bit 0 clear means keyframe.
	return payload[offset]&0x01 == 0
}

// isH264Keyframe looks for an IDR slice (NAL type 5) or a parameter set
// (SPS 7 / PPS 8) in an RFC 6184 payload.
//
// Parameter sets count as a switch point because they immediately precede
// the IDR they describe, and a decoder handed the IDR without them cannot
// use it. STAP-A aggregation packets are unpacked, since browsers commonly
// bundle SPS+PPS+IDR into one.
func isH264Keyframe(payload []byte) bool {
	if len(payload) < 1 {
		return false
	}

	switch nalType := payload[0] & 0x1F; nalType {
	case 5, 7, 8: // IDR, SPS, PPS
		return true

	case 24: // STAP-A: a sequence of length-prefixed NAL units
		offset := 1
		for offset+2 < len(payload) {
			size := int(payload[offset])<<8 | int(payload[offset+1])
			offset += 2
			if size <= 0 || offset+size > len(payload) {
				return false
			}
			switch payload[offset] & 0x1F {
			case 5, 7, 8:
				return true
			}
			offset += size
		}
		return false

	case 28, 29: // FU-A / FU-B fragment
		if len(payload) < 2 {
			return false
		}
		// Only the first fragment (S bit) tells us what is being
		// fragmented; a middle fragment is not a switch point even if the
		// frame it belongs to is a keyframe.
		if payload[1]&0x80 == 0 {
			return false
		}
		return payload[1]&0x1F == 5

	default:
		return false
	}
}

// isVP9Keyframe reads the VP9 payload descriptor's P bit (draft-ietf-
// payload-vp9 §4.2): an unset P means the frame has no inter-picture
// dependencies, and the B bit marks the start of the frame.
func isVP9Keyframe(payload []byte) bool {
	if len(payload) < 1 {
		return false
	}
	interPicturePredicted := payload[0]&0x40 != 0
	startOfFrame := payload[0]&0x08 != 0
	return startOfFrame && !interPicturePredicted
}
