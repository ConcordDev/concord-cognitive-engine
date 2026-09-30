using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.Vehicles
{
    /// <summary>
    /// Serializable boundary DTO for VehicleEntity. Conversion delegates restoration
    /// to the existing IVehiclePersistence/VehiclePersistenceRecord contract.
    /// </summary>
    [Serializable]
    public sealed class VehiclePersistenceDto
    {
        public string EntityId;
        public int Kind;
        public float Px;
        public float Py;
        public float Pz;
        public float Rx;
        public float Ry;
        public float Rz;
        public float Rw = 1f;
        public float Health;
        public string OwnerId;
        public List<VehicleItem> Inventory = new List<VehicleItem>();
        public List<VehicleItem> StoredItems = new List<VehicleItem>();

        public static VehiclePersistenceDto FromEntity(VehicleEntity entity)
        {
            if (!entity) return null;
            var record = entity.CaptureState();
            var dto = new VehiclePersistenceDto
            {
                EntityId = record.EntityId,
                Kind = record.Kind,
                Px = record.Px,
                Py = record.Py,
                Pz = record.Pz,
                Rx = record.Rx,
                Ry = record.Ry,
                Rz = record.Rz,
                Rw = record.Rw,
                Health = record.Health,
                OwnerId = record.OwnerId
            };
            CopyItems(entity.Inventory, dto.Inventory);
            CopyItems(entity.StoredItems, dto.StoredItems);
            return dto;
        }

        public static VehiclePersistenceDto FromContractRecord(VehiclePersistenceRecord record)
        {
            if (record == null) return null;
            var dto = new VehiclePersistenceDto
            {
                EntityId = record.EntityId,
                Kind = record.Kind,
                Px = record.Px,
                Py = record.Py,
                Pz = record.Pz,
                Rx = record.Rx,
                Ry = record.Ry,
                Rz = record.Rz,
                Rw = record.Rw,
                Health = record.Health,
                OwnerId = record.OwnerId
            };
            CopyItems(record.Inventory, dto.StoredItems);
            return dto;
        }

        public VehiclePersistenceRecord ToContractRecord()
        {
            var record = new VehiclePersistenceRecord
            {
                EntityId = EntityId,
                Kind = Kind,
                Px = Px,
                Py = Py,
                Pz = Pz,
                Rx = Rx,
                Ry = Ry,
                Rz = Rz,
                Rw = Rw,
                Health = Health,
                OwnerId = OwnerId
            };
            CopyItems(Inventory, record.Inventory);
            CopyItems(StoredItems, record.Inventory);
            return record;
        }

        public bool ApplyTo(VehicleEntity entity)
        {
            if (!entity || string.IsNullOrEmpty(EntityId) || EntityId != entity.EntityId) return false;
            entity.RestoreState(ToContractRecord());
            return true;
        }

        public string[] StorageIdentifiers()
        {
            var result = new List<string>();
            AddIdentifiers(Inventory, result);
            AddIdentifiers(StoredItems, result);
            return result.ToArray();
        }

        public string ToJson(bool prettyPrint = false)
        {
            return JsonUtility.ToJson(this, prettyPrint);
        }

        public static VehiclePersistenceDto FromJson(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            return JsonUtility.FromJson<VehiclePersistenceDto>(json);
        }

        public static List<VehiclePersistenceDto> CaptureRegisteredVehicles()
        {
            var result = new List<VehiclePersistenceDto>();
            foreach (var vehicle in VehiclePersistenceService.Vehicles)
            {
                var dto = FromEntity(vehicle);
                if (dto != null) result.Add(dto);
            }
            return result;
        }

        static void CopyItems(IReadOnlyList<VehicleItem> source, List<VehicleItem> destination)
        {
            if (source == null || destination == null) return;
            for (var i = 0; i < source.Count; i++)
            {
                var item = source[i];
                if (item != null) destination.Add(new VehicleItem(item.ItemId, item.Quantity));
            }
        }

        static void AddIdentifiers(IReadOnlyList<VehicleItem> source, List<string> destination)
        {
            if (source == null) return;
            for (var i = 0; i < source.Count; i++)
            {
                var item = source[i];
                if (item != null && !string.IsNullOrEmpty(item.ItemId)) destination.Add(item.ItemId);
            }
        }
    }
}
