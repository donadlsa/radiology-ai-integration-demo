"""
Synthetic DICOM File Generator

Generates synthetic DICOM files for demonstration purposes.
All patient data is fictional -- no real PHI is used or referenced.
This allows the demo to be fully self-contained without requiring
access to clinical DICOM images.
"""

import os
import numpy as np
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.uid import generate_uid, ExplicitVRLittleEndian
from pydicom.sequence import Sequence
from datetime import datetime


# Output directory
SAMPLE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "sample_data", "dicom")


def generate_chest_xray() -> Dataset:
    """Generate a synthetic Chest X-ray (CR) DICOM file.

    Creates a minimal but valid DICOM Computed Radiography instance
    with realistic metadata matching the patient/study from our
    HL7 sample messages. Pixel data is synthetic noise -- just enough
    to make the file structurally valid.

    Returns:
        pydicom Dataset with all required DICOM tags populated.
    """
    filepath = os.path.join(SAMPLE_DIR, "chest_xray.dcm")
    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.1"  # CR Image Storage
    file_meta.MediaStorageSOPInstanceUID = generate_uid()
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    ds = FileDataset(filepath, {}, file_meta=file_meta, preamble=b"\x00" * 128)

    # Patient Module -- matches our HL7 sample patient (Jane Doe)
    ds.PatientName = "DOE^JANE^M"
    ds.PatientID = "MRN-2024-78432"
    ds.PatientBirthDate = "19580312"
    ds.PatientSex = "F"

    # Study Module
    ds.StudyInstanceUID = generate_uid()
    ds.StudyDate = "20260115"
    ds.StudyTime = "143025"
    ds.AccessionNumber = "ACC-20260115-56"
    ds.ReferringPhysicianName = "SMITH^ROBERT^J"
    ds.StudyID = "STUDY-001"
    ds.StudyDescription = "CHEST 2 VIEWS"

    # Series Module
    ds.SeriesInstanceUID = generate_uid()
    ds.SeriesNumber = 1
    ds.Modality = "CR"
    ds.SeriesDescription = "CHEST PA AND LATERAL"
    ds.BodyPartExamined = "CHEST"

    # General Equipment Module
    ds.Manufacturer = "SYNTHETIC"
    ds.InstitutionName = "MAIN HOSPITAL"
    ds.StationName = "CR_ROOM_1"
    ds.InstitutionalDepartmentName = "RADIOLOGY"

    # SOP Common Module
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.1"  # CR Image Storage
    ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
    ds.InstanceCreationDate = "20260115"
    ds.InstanceCreationTime = "143025"

    # Image Module -- Routing-relevant DICOM tags
    ds.ImageType = ["ORIGINAL", "PRIMARY"]
    ds.InstanceNumber = 1
    ds.ContentDate = "20260115"
    ds.ContentTime = "143025"

    # Source AE Title is a File Meta element (0002,0016)
    file_meta.SourceApplicationEntityTitle = "CR_ROOM1"

    # Image Pixel Module -- synthetic 256x256 grayscale image
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.Rows = 256
    ds.Columns = 256
    ds.BitsAllocated = 16
    ds.BitsStored = 12
    ds.HighBit = 11
    ds.PixelRepresentation = 0
    ds.PixelData = np.random.randint(0, 4096, (256, 256), dtype=np.uint16).tobytes()

    ds.is_little_endian = True
    ds.is_implicit_VR = False

    return ds


def generate_ct_series(num_slices: int = 3) -> list:
    """Generate a synthetic CT series with multiple slices.

    Creates a minimal CT series to demonstrate multi-instance
    DICOM handling. Shares the same Study UID as the chest X-ray
    to simulate a multi-modality exam.

    Args:
        num_slices: Number of CT slices to generate.

    Returns:
        List of pydicom Datasets, one per slice.
    """
    study_uid = generate_uid()
    series_uid = generate_uid()
    datasets = []

    for i in range(num_slices):
        filepath = os.path.join(SAMPLE_DIR, f"ct_slice_{i+1:03d}.dcm")
        file_meta = FileMetaDataset()
        file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"  # CT Image Storage
        file_meta.MediaStorageSOPInstanceUID = generate_uid()
        file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

        ds = FileDataset(filepath, {}, file_meta=file_meta, preamble=b"\x00" * 128)

        # Patient Module
        ds.PatientName = "DOE^JANE^M"
        ds.PatientID = "MRN-2024-78432"
        ds.PatientBirthDate = "19580312"
        ds.PatientSex = "F"

        # Study Module
        ds.StudyInstanceUID = study_uid
        ds.StudyDate = "20260115"
        ds.StudyTime = "150000"
        ds.AccessionNumber = "ACC-20260115-9012"
        ds.ReferringPhysicianName = "SMITH^ROBERT^J"
        ds.StudyID = "STUDY-002"
        ds.StudyDescription = "CT CHEST WITH CONTRAST"

        # Series Module
        ds.SeriesInstanceUID = series_uid
        ds.SeriesNumber = 1
        ds.Modality = "CT"
        ds.SeriesDescription = "AXIAL 5MM"
        ds.BodyPartExamined = "CHEST"

        # General Equipment
        ds.Manufacturer = "SYNTHETIC"
        ds.InstitutionName = "MAIN HOSPITAL"
        ds.StationName = "CT_SCANNER_1"

        # SOP Common
        ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
        ds.SOPInstanceUID = file_meta.MediaStorageSOPInstanceUID
        ds.InstanceNumber = i + 1

        # CT-specific
        ds.ImageType = ["ORIGINAL", "PRIMARY", "AXIAL"]
        ds.SliceThickness = 5.0
        ds.SliceLocation = float(i * 5)
        ds.ImagePositionPatient = [0.0, 0.0, float(i * 5)]
        ds.ImageOrientationPatient = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
        ds.ContentDate = "20260115"
        ds.ContentTime = f"15{i:02d}00"

        # Pixel data -- 128x128 synthetic
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.Rows = 128
        ds.Columns = 128
        ds.BitsAllocated = 16
        ds.BitsStored = 12
        ds.HighBit = 11
        ds.PixelRepresentation = 1  # Signed for CT (Hounsfield units)
        ds.RescaleIntercept = -1024.0
        ds.RescaleSlope = 1.0
        ds.PixelData = np.random.randint(-1024, 3072, (128, 128), dtype=np.int16).tobytes()

        ds.is_little_endian = True
        ds.is_implicit_VR = False

        datasets.append(ds)

    return datasets


def save_datasets():
    """Generate and save all synthetic DICOM files to sample_data/dicom/."""
    os.makedirs(SAMPLE_DIR, exist_ok=True)

    # Chest X-ray
    cxr = generate_chest_xray()
    cxr.save_as(os.path.join(SAMPLE_DIR, "chest_xray.dcm"))
    print(f"  Created: chest_xray.dcm (CR, {cxr.Rows}x{cxr.Columns})")

    # CT series
    ct_series = generate_ct_series(3)
    for i, ds in enumerate(ct_series):
        ds.save_as(os.path.join(SAMPLE_DIR, f"ct_slice_{i+1:03d}.dcm"))
        print(f"  Created: ct_slice_{i+1:03d}.dcm (CT, slice {i+1})")

    print(f"\n  All files saved to: {os.path.abspath(SAMPLE_DIR)}")


if __name__ == "__main__":
    print("Generating synthetic DICOM files...")
    save_datasets()
