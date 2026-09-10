package room

import "strings"

// isKeyframe reports whether an RTP payload starts a decodable frame.
//
// This matters for exactly one reason. Switch a subscriber between
// simulcast layers mid-frame and their decoder gets a picture referencing
// frames it never received, which comes out as several seconds of green
// smear or a frozen image. Waiting for a keyframe is what makes the switch
// invisible.
//
// Only covers the codecs Livqeno forwards video in. Audio needs none of this,
// since every packet is independently decodable. An unrecognised video
// codec returns false, which is the safe answer: the layer switch just
// waits, and a PLI forces a keyframe out of the publisher eventually.
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
// §4.2) to get at the frame header's keyframe bit.
//
// The descriptor is variable-length. A bitmask byte says which optional
// fields follow, so you have to compute where the payload header starts;
// you can't assume it.
func isVP8Keyframe(payload []byte) bool {
	if len(payload) < 1 {
		return false
	}

	offset := 1
	extended := payload[0]&0x80 != 0
	startOfPartition := payload[0]&0x10 != 0
	partitionIndex := payload[0] & 0x07

	// Only a frame's first partition carries the frame header. There's no
	// keyframe bit to read on a continuation packet.
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

// isH264Keyframe hunts for an IDR slice (NAL type 5) or a parameter set
// (SPS 7 / PPS 8) in an RFC 6184 payload.
//
// Parameter sets count as switch points. They come immediately before the
// IDR they describe, and a decoder handed that IDR without them can't do
// anything with it. We unpack STAP-A aggregation packets too, since
// browsers love bundling SPS+PPS+IDR into a single one.
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
		// Only the first fragment (S bit) says what's being fragmented. A
		// middle fragment isn't a switch point even when the frame it
		// belongs to is a keyframe.
		if payload[1]&0x80 == 0 {
			return false
		}
		return payload[1]&0x1F == 5

	default:
		return false
	}
}

// isVP9Keyframe reads the VP9 payload descriptor's P bit (draft-ietf-
// payload-vp9 §4.2). P unset means the frame has no inter-picture
// dependencies; the B bit marks where the frame starts.
func isVP9Keyframe(payload []byte) bool {
	if len(payload) < 1 {
		return false
	}
	interPicturePredicted := payload[0]&0x40 != 0
	startOfFrame := payload[0]&0x08 != 0
	return startOfFrame && !interPicturePredicted
}
