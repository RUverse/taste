"""Read and write .taste files: collections of media that share a vibe, in one portable file."""

__version__ = "0.1.0"

from taste.container import MIMETYPE, TasteError  # noqa: E402
from taste.document import Taste, actor, slugify  # noqa: E402
from taste.validate import VERSION, Problem, validate_manifest  # noqa: E402

__all__ = [
    "MIMETYPE",
    "VERSION",
    "Problem",
    "Taste",
    "TasteError",
    "__version__",
    "actor",
    "slugify",
    "validate_manifest",
]
