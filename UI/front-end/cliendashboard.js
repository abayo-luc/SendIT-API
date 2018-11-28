const getUserParcels = async () => {
  const token = await localStorage.getItem("token");
  const user = await JSON.parse(
    localStorage.getItem("user")
  );
  fetch(`/api/v1/users/${user.id}/parcels`, {
    method: "GET",
    headers: {
      "Content-Type": "Application/JSON",
      Authorization: `Bearer ${token}`
    }
  })
    .then(response => {
      response.json().then(data => {
        const { parcels } = data;
        if (parcels) {
          dataReady();
          parcels.map(parcel => {
            $("#user-parcels").append(`
            <tr onClick=getParcel(${parcel.id})>
                <td>${parcel.pickup_location || "..."}</td>
                <td>${parcel.address.pickup_address ||
                  "..."}</td>
                <td>${parcel.destination || "..."}</td>
                <td>${parcel.address.destination_address ||
                  "..."}</td>
                <td>
                    <span> 
                    Q:${parcel.details.quantity}
                    </span> 
                    <span> 
                    W:${parcel.details.weight}
                    </span>
                    <span> 
                    ${
                      parcel.details.length
                        ? `L:${parcel.details.length}`
                        : ""
                    }
                    </span> 
                    <span> 
                    ${
                      parcel.details.height
                        ? `H:${parcel.details.height}`
                        : ""
                    }
                    </span>
                </td>
                <td>${new Date(
                  parcel.created_at
                ).toDateString()}</td>
                <td>....</td>
                <td>....</td>
                <td>${
                  parcel.status === "delivered"
                    ? "delivered"
                    : "false"
                }</td>
            </tr>
            `);
          });
        }
      });
    })
    .catch(err => {
      console.log(err);
    });
};
const dataReady = () => {
  $("#loader").css("display", "none");
  $("#loaded-data").css("display", "block");
  return;
};
switch (document.readyState) {
  case "loading":
    getUserParcels();
  default:
    "";
}