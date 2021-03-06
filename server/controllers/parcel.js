import {
  STATUS_WAITING,
  STATUS_INTRANSIT,
  STATUS_DELIVERED,
  STATUS_CANCELED
} from "../utils/constants";
import moment from "moment";
//bring the db
import db from "../database";
import httpResponses from "../utils/httpResponses";
import validations from "../utils/validators.helpers";
import { isEmpty } from "../utils/helper.functions";
import { sendEmail } from "../config/mailer";
// new parce instance from parcel model
export default class Parcel {
  static findAll(req, res) {
    const queryText = `SELECT * FROM parcels`;
    db.query(queryText, null, true)
      .then(parcels => {
        httpResponses.ok(res, 200, "parcels", parcels, "success");
      })
      .catch(err => {
        httpResponses.bad(req, 500, "failed", "Internal error", err);
      });
  }

  static findById(req, res) {
    db.findById("parcels", parseInt(req.params.id, 10))
      .then(parcel => {
        if (!parcel) {
          return httpResponses.bad(res, 404, "failed", "Parcel not found");
        }
        if (req.user["is_admin"] || req.user.id === parcel.user_id) {
          return httpResponses.ok(res, 200, "parcel", parcel, "success");
        }
        return httpResponses.unauthorized(res);
      })
      .catch(err => {
        httpResponses.bad(res, 500, "failed", "Internal server error", err);
      });
  }

  static create(req, res) {
    const queryText = `
    INSERT INTO parcels(  
        pickup_location, 
        destination, 
        address, 
        details, 
        current_location, 
        status,
        user_id,
        created_at,
        updated_at)
    VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
    returning *
    `;
    let address = {};
    if (req.body.pickupAddress)
      address["pickup_address"] = req.body.pickupAddress;
    if (req.body.destinationAddress)
      address["destination_address"] = req.body.destinationAddress;
    const { quantity, weight, height, width, length } = req.body;
    let details = {
      quantity,
      weight,
      height,
      width,
      length
    };
    const currentLocation = req.body.pickupLocation;
    const userId = req.user.id;
    const newParcel = [
      req.body.pickupLocation,
      req.body.destination,
      address,
      details,
      currentLocation,
      STATUS_WAITING,
      userId,
      moment(new Date()),
      moment(new Date())
    ];
    db.query(queryText, newParcel)
      .then(parcelRes => {
        httpResponses.ok(res, 201, "parcel", parcelRes, "success");
      })
      .catch(err => {
        httpResponses.bad(res, 500, "failed", "Internal server errror", err);
      });
  }
  //update parcel
  static update(req, res) {
    const parcelQuery = "SELECT * FROM parcels WHERE id = $1 AND user_id = $2";
    db.query(parcelQuery, [parseInt(req.params.id), parseInt(req.user.id)])
      .then(parcel => {
        if (!parcel) {
          return httpResponses.bad(res, 404, "failed", "Parcel not found");
        }

        const updateQuery = `UPDATE parcels SET 
        destination=$1, 
        address=$2,
        updated_at=$3
        WHERE id=$4 AND user_id=$5
        returning *
       `;
        let address = { ...parcel.address };
        if (req.body.destinationAddress)
          address["destination_address"] = req.body.destinationAddress;

        const values = [
          req.body.destination || parcel["destination"],
          !isEmpty(address) ? address : parcel.address,
          moment(new Date()),
          parseFloat(req.params.id),
          parseFloat(req.user.id)
        ];
        db.query(updateQuery, values)
          .then(response => {
            const updatedParcel = response;
            httpResponses.ok(res, 201, "parcel", updatedParcel, "success");
          })
          .catch(err => {
            httpResponses.bad(res, 500, "failed", "Intern server error", err);
          });
      })
      .catch(err => {
        httpResponses.bad(res, 500, "failed", "Intern server error", err);
      });
  }

  //cancel parcel by updating its status
  static cancel(req, res) {
    const parcelQuery = `UPDATE parcels SET status=$1, updated_at = $2 WHERE id = $3 AND user_id = $4 returning *`;
    const values = [
      STATUS_CANCELED,
      moment(new Date()),
      parseInt(req.params.id),
      parseInt(req.user.id)
    ];
    db.query(parcelQuery, values)
      .then(async response => {
        if (!response) {
          return httpResponses.bad(res, 404, "failed", "Parcel not found");
        }
        sendNotification(response.id);
        return httpResponses.ok(res, 202, "parcel", response, "success");
      })
      .catch(err => {
        httpResponses.bad(res, 500, "failed", "Intern server error", err);
      });
  }

  static changeStatus(req, res) {
    if (!validations.isStatusExist(req.body)) {
      return httpResponses.bad(
        res,
        400,
        "failed",
        `Status should one of ${STATUS_WAITING}, ${STATUS_INTRANSIT} or ${STATUS_DELIVERED}}`
      );
    }
    const psqlQuery =
      "UPDATE parcels SET status=$1, updated_at=$2 WHERE id=$3 RETURNING *";
    const values = [req.body.status, moment(new Date()), req.params.id];
    db.query(psqlQuery, values)
      .then(async parcel => {
        if (!parcel) {
          return httpResponses.bad(res, 404, "failed", "parcel not found");
        }
        await sendNotification(parcel.id);
        httpResponses.ok(res, 201, "parcel", parcel, "success");
      })
      .catch(err => {
        console.log(err);
        httpResponses.bad(res, 500, "failed", "Internal server", err);
      });
  }
  static presentLocation(req, res) {
    const {
      presentLocation,
      currentLocation,
      status = STATUS_INTRANSIT
    } = req.body;
    const location = presentLocation || currentLocation;
    const psqlQuery =
      "UPDATE parcels SET current_location=$1, arrived_at=$2, status=$3 WHERE id=$4 RETURNING *";
    const values = [location, moment(new Date()), status, req.params.id];
    db.query(psqlQuery, values)
      .then(async parcel => {
        if (!parcel) {
          return httpResponses.bad(res, 404, "failed", "parcel not found");
        }
        await sendNotification(parcel.id);
        httpResponses.ok(res, 201, "parcel", parcel, "success");
      })
      .catch(err => {
        httpResponses.bad(res, 500, "failed", "Internal server", err);
      });
  }
}

const sendNotification = id => {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  const sqlQuery = `SELECT 
    parcels.id, 
    parcels.destination, 
    parcels.current_location, 
    parcels.details,
    parcels.address,
    parcels.status, 
    users.email, 
    users.first_name, 
    users.last_name
    FROM 
    parcels
    INNER JOIN users ON parcels.user_id = users.id
    WHERE
    parcels.id = $1`;
  const values = [id];
  db.query(sqlQuery, values)
    .then(parcel => {
      sendEmail(parcel).then(resp => {
        return { success: true };
      });
    })
    .catch(err => {
      console.log(err);
    });
};
