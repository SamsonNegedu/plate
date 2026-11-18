package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/danielgtaylor/huma/v2"
)

// Problem is an RFC 9457 problem response with a stable machine code and the request id.
type Problem struct {
	Type      string   `json:"type,omitempty"`
	Title     string   `json:"title"`
	Status    int      `json:"status"`
	Detail    string   `json:"detail,omitempty"`
	Code      string   `json:"code"`
	RequestID string   `json:"request_id,omitempty"`
	Errors    []Detail `json:"errors,omitempty"`

	// Optional hints the client acts on.
	Reason         string       `json:"reason,omitempty"`
	RetryAfter     *int         `json:"retry_after,omitempty"`
	CanAddManually *bool        `json:"can_add_manually,omitempty"`
	Product        *ProductHint `json:"product,omitempty"`
	MinSeq         *int64       `json:"min_seq,omitempty"`
}

// ProductHint describes a product that exists but cannot be logged.
type ProductHint struct {
	Name      string  `json:"name"`
	ImagePath *string `json:"image_path"`
}

type Detail struct {
	Message  string `json:"message"`
	Location string `json:"location,omitempty"`
}

func (p *Problem) Error() string  { return p.Detail }
func (p *Problem) GetStatus() int { return p.Status }

func (p *Problem) ContentType(string) string { return "application/problem+json" }

// Err builds a problem for handlers: Err(404, "food_not_found", "...").
func Err(status int, code, detail string) *Problem {
	return &Problem{Title: http.StatusText(status), Status: status, Code: code, Detail: detail}
}

var defaultCodes = map[int]string{
	http.StatusBadRequest:            "bad_request",
	http.StatusUnauthorized:          "unauthorized",
	http.StatusForbidden:             "forbidden",
	http.StatusNotFound:              "not_found",
	http.StatusConflict:              "conflict",
	http.StatusUnprocessableEntity:   "validation_failed",
	http.StatusRequestEntityTooLarge: "payload_too_large",
	http.StatusTooManyRequests:       "rate_limited",
	http.StatusServiceUnavailable:    "unavailable",
}

type ctxKey int

const requestIDKey ctxKey = 1

// RequestID returns the id the middleware attached to ctx.
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

func installErrorModel() {
	huma.NewError = func(status int, msg string, errs ...error) huma.StatusError {
		return newProblem("", status, msg, errs)
	}
	huma.NewErrorWithContext = func(ctx huma.Context, status int, msg string, errs ...error) huma.StatusError {
		return newProblem(RequestID(ctx.Context()), status, msg, errs)
	}
}

func newProblem(requestID string, status int, msg string, errs []error) *Problem {
	code := defaultCodes[status]
	if code == "" {
		code = "error"
		if status >= 500 {
			code = "internal"
		}
	}
	p := &Problem{Title: http.StatusText(status), Status: status, Detail: msg, Code: code, RequestID: requestID}
	for _, e := range errs {
		var pe *Problem
		if errors.As(e, &pe) {
			p.Code = pe.Code
			if pe.Detail != "" {
				p.Detail = pe.Detail
			}
			continue
		}
		d := Detail{Message: e.Error()}
		if le, ok := e.(interface{ ErrorDetail() *huma.ErrorDetail }); ok {
			if ed := le.ErrorDetail(); ed != nil {
				d = Detail{Message: ed.Message, Location: ed.Location}
			}
		}
		p.Errors = append(p.Errors, d)
	}
	return p
}
